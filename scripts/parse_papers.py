# -*- coding: utf-8 -*-
"""Parse exam docx + mp3 into public/data/papers.json and linked audio."""
from __future__ import annotations

import json
import os
import re
import shutil
import sys
import zipfile
from xml.etree import ElementTree as ET

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SOURCE = r"C:\Users\yjc08\Documents\xwechat_files\wxid_j54mh8as5njn22_7e76\msg\file\2026-07\真题前30\真题前30"
PUBLIC = os.path.join(ROOT, "public")
DATA_DIR = os.path.join(PUBLIC, "data")
AUDIO_DIR = os.path.join(PUBLIC, "audio")
NS_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

SKIP_LINE = re.compile(
    r"^(choose the best response|listen to (a |an )?(conversation|announcement|talk).*)\s*$",
    re.I,
)
TIMESTAMP = re.compile(r"^[•·\-\s]*\d+:\d+\s*/\s*\d+:\d+[:：]?\s*$")
SECTION_HEAD = re.compile(
    r"(\d+)\s*[-–—~～]\s*(\d+)\s*[\[［\(（]([^\]］\)）]+)[\]］\)）]"
)
Q_START = re.compile(r"^(\d{1,2})\s*[\.、．]\s*(.*)$")
OPT_START = re.compile(r"^([A-Da-d])[\.．、\)）]\s*(.*)$")
KEY_LINE = re.compile(
    r"^(?:key|答案)\s*[:：]\s*([A-Da-d](?:[\s,，、]*[A-Da-d])*)\s*$",
    re.I,
)
BARE_RANGE = re.compile(
    r"^(\d+)\s*[-–—~～]\s*(\d+)\s+(Choose the best response.*)$",
    re.I,
)
MODULE_HEAD = re.compile(r"^module\s*([12])\b", re.I)
VOCAB_HEAD = re.compile(
    r"^[一二三四五六七八九十\d、.\s]*(\d+)\s*[–\-—~～]\s*(\d+)\s*[【\[]([^】\]]+)"
)


def docx_paragraphs(path: str) -> list[str]:
    with zipfile.ZipFile(path) as z:
        xml = z.read("word/document.xml")
    root = ET.fromstring(xml)
    paras: list[str] = []
    for p in root.iter(f"{NS_W}p"):
        texts = [t.text for t in p.iter(f"{NS_W}t") if t.text]
        if texts:
            line = "".join(texts).replace("\ufeff", "").replace("\u200b", "").strip()
            if line:
                paras.append(line)
    return paras


def clean_lines(paras: list[str]) -> list[str]:
    out = []
    for line in paras:
        line = line.replace("\ufeff", "").strip()
        if not line or TIMESTAMP.match(line):
            continue
        if SKIP_LINE.match(line):
            continue
        if re.match(r"^26?\s*真题\s*\d+\s*$", line):
            continue
        out.append(line)
    return out


def parse_key_letters(blob: str) -> list[str]:
    return [c.upper() for c in re.findall(r"[A-Da-d]", blob)]


def classify_kind(title: str) -> tuple[str, int | None]:
    t = re.sub(r"\s+", "", title)
    t = t.replace("重复", "")
    m = re.search(r"(\d+)$", t)
    idx = int(m.group(1)) if m else None
    if "对话回复" in t or t.startswith("回复"):
        return "reply", idx
    if "短对话" in t:
        return "convo", idx
    if "公告" in t:
        return "announce", idx
    if "讲座" in t or "talk" in t.lower() or "学术" in t:
        return "lecture", idx
    if "对话" in t:
        return "convo", idx
    return "other", idx


def kind_title(kind: str, index: int | None) -> str:
    names = {
        "reply": "对话回复",
        "convo": "短对话",
        "announce": "公告",
        "lecture": "讲座",
        "other": "题目",
    }
    base = names.get(kind, "题目")
    if kind == "reply" or index is None:
        return base
    return f"{base} {index}"


def parse_questions(kind: str, q_start: int, q_end: int, body: list[str]) -> tuple[list[dict], str]:
    questions: list[dict] = []
    transcript_lines: list[str] = []
    current: dict | None = None
    expected = q_end - q_start + 1

    def flush():
        nonlocal current
        if current and current.get("options"):
            questions.append(current)
        current = None

    def assign_keys(letters: list[str]):
        flush()
        unanswered = [q for q in questions if not q.get("answer")]
        if len(letters) == 1 and unanswered:
            unanswered[-1]["answer"] = letters[0]
            return
        for q, letter in zip(unanswered, letters):
            q["answer"] = letter

    for raw in body:
        line = raw.strip()
        if not line:
            continue
        km = KEY_LINE.match(line)
        if km:
            assign_keys(parse_key_letters(km.group(1)))
            continue

        qm = Q_START.match(line)
        if qm:
            num = int(qm.group(1))
            if q_start <= num <= q_end:
                flush()
                current = {
                    "n": num,
                    "stem": qm.group(2).strip(),
                    "options": {},
                    "answer": "",
                }
                continue

        om = OPT_START.match(line)
        if om:
            letter = om.group(1).upper()
            text = om.group(2).strip()
            if current is None and letter == "A":
                stem = " ".join(transcript_lines).strip()
                transcript_lines = []
                n = q_start + len(questions)
                current = {"n": n, "stem": stem, "options": {}, "answer": ""}
            if current is not None:
                current["options"][letter] = text
            continue

        if current is not None:
            if current["options"]:
                last = list(current["options"])[-1]
                current["options"][last] = (current["options"][last] + " " + line).strip()
            else:
                current["stem"] = (current["stem"] + " " + line).strip()
        else:
            if not SKIP_LINE.match(line):
                transcript_lines.append(line)

    flush()

    transcript = "" if kind == "reply" else re.sub(r"\s+", " ", " ".join(transcript_lines)).strip()

    for i, q in enumerate(questions):
        if not q.get("n"):
            q["n"] = q_start + i
        for letter in "ABCD":
            q["options"].setdefault(letter, "")

    if len(questions) > expected:
        questions = questions[:expected]
    return questions, transcript


def split_modules(lines: list[str]) -> dict[str, list[str]]:
    modules: dict[str, list[str]] = {"m1": [], "m2": []}
    current = "m1"
    started = False
    for line in lines:
        mm = MODULE_HEAD.match(line)
        if mm:
            started = True
            current = f"m{mm.group(1)}"
            continue
        if not started:
            current = "m1"
            started = True
        modules[current].append(line)
    return modules


def parse_module(mod_id: str, lines: list[str]) -> list[dict]:
    heads = []
    for i, line in enumerate(lines):
        sm = SECTION_HEAD.search(line)
        if sm:
            heads.append((i, int(sm.group(1)), int(sm.group(2)), sm.group(3).strip(), line))
            continue
        sm = BARE_RANGE.match(line)
        if sm:
            heads.append((i, int(sm.group(1)), int(sm.group(2)), "对话回复", line))
    sections = []
    counters = {"reply": 0, "convo": 0, "announce": 0, "lecture": 0, "other": 0}

    def add_section(kind, sidx, qs, qe, questions, transcript):
        if not questions:
            return
        if sidx is None and kind != "reply":
            counters[kind] = counters.get(kind, 0) + 1
            sidx = counters[kind]
        elif sidx is not None:
            counters[kind] = max(counters.get(kind, 0), sidx)
        sec_id = f"{mod_id}-{kind}" if kind == "reply" else f"{mod_id}-{kind}-{sidx or 1}"
        sections.append(
            {
                "id": sec_id,
                "kind": kind,
                "title": kind_title(kind, sidx),
                "index": sidx,
                "qStart": qs,
                "qEnd": qe,
                "transcript": transcript,
                "vocab": [],
                "questions": questions,
            }
        )

    if heads and heads[0][0] > 0 and heads[0][1] > 1:
        qs, qe = 1, heads[0][1] - 1
        questions, transcript = parse_questions("reply", qs, qe, lines[: heads[0][0]])
        add_section("reply", None, qs, qe, questions, transcript)
    if not heads:
        questions, transcript = parse_questions("reply", 1, 32, lines)
        add_section("reply", None, 1, 32, questions, transcript)
        return sections

    for idx, (line_i, qs, qe, title, raw) in enumerate(heads):
        end = heads[idx + 1][0] if idx + 1 < len(heads) else len(lines)
        body = lines[line_i + 1 : end]
        leftover = SECTION_HEAD.sub("", raw).strip()
        leftover = BARE_RANGE.sub("", leftover).strip()
        leftover = re.sub(r"^[-–—\s]+", "", leftover)
        if leftover and not SKIP_LINE.match(leftover) and "choose the best response" not in leftover.lower():
            body = [leftover] + body
        kind, sidx = classify_kind(title)
        if sidx is None:
            counters[kind] = counters.get(kind, 0) + 1
            sidx = counters[kind]
            if kind == "reply":
                sidx = None
        else:
            counters[kind] = max(counters.get(kind, 0), sidx)
        questions, transcript = parse_questions(kind, qs, qe, body)
        sec_id = f"{mod_id}-{kind}" if kind == "reply" else f"{mod_id}-{kind}-{sidx or 1}"
        sections.append(
            {
                "id": sec_id,
                "kind": kind,
                "title": kind_title(kind, sidx),
                "index": sidx,
                "qStart": qs,
                "qEnd": qe,
                "transcript": transcript,
                "vocab": [],
                "questions": questions,
            }
        )
    return sections


def pick_answer_doc(folder: str, files: list[str]) -> str | None:
    scored = []
    for f in files:
        if not f.endswith(".docx") or f.startswith("~$") or "生词" in f:
            continue
        path = os.path.join(folder, f)
        try:
            text = "\n".join(docx_paragraphs(path))
        except Exception:
            continue
        key_n = len(re.findall(r"\bKey\b|KEY\s*[:：]|答案\s*[:：]", text, re.I))
        bonus = 20 if any(k in f for k in ("教师", "原文", "答案", "文本")) else 0
        penalty = 10 if "学生" in f else 0
        scored.append((key_n + bonus - penalty, key_n, f))
    scored.sort(reverse=True)
    if not scored:
        return None
    return os.path.join(folder, scored[0][2])


def pick_vocab_doc(folder: str, files: list[str]) -> str | None:
    for f in files:
        if f.endswith(".docx") and not f.startswith("~$") and "生词" in f:
            return os.path.join(folder, f)
    return None


def parse_vocab(path: str) -> list[tuple[int, int, str, list[dict]]]:
    paras = docx_paragraphs(path)
    groups: list[tuple[int, int, str, list[dict]]] = []
    current = None
    word_re = re.compile(
        r"^(.+?)\s+(n\.|v\.|adj\.|adv\.|phr\.|prep\.|conj\.|pron\.|num\.|vt\.|vi\.|n/v\.|phr\.v\.)\s+(.+)$"
    )
    for line in paras:
        hm = VOCAB_HEAD.search(line)
        if hm:
            if current:
                groups.append(current)
            current = (int(hm.group(1)), int(hm.group(2)), hm.group(3).strip(), [])
            continue
        if current is None:
            continue
        wm = word_re.match(line)
        if wm:
            current[3].append(
                {"word": wm.group(1).strip(), "pos": wm.group(2).strip(), "meaning": wm.group(3).strip()}
            )
        elif line and not re.match(r"^[一二三四五六七八九十]、", line):
            current[3].append({"word": line, "pos": "", "meaning": ""})
    if current:
        groups.append(current)
    return groups


def attach_vocab(sections: list[dict], groups: list[tuple[int, int, str, list[dict]]]) -> None:
    used = set()
    for sec in sections:
        for i, (qs, qe, title, words) in enumerate(groups):
            if i in used:
                continue
            if sec["qStart"] == qs and sec["qEnd"] == qe:
                sec["vocab"] = words
                used.add(i)
                break
        if not sec["vocab"]:
            for i, (qs, qe, title, words) in enumerate(groups):
                if i in used:
                    continue
                if qs <= sec["qStart"] and qe >= sec["qEnd"]:
                    sec["vocab"] = words
                    used.add(i)
                    break


def list_mp3(folder: str) -> list[str]:
    found = []
    for root, dirs, files in os.walk(folder):
        dirs[:] = [d for d in dirs if not d.startswith("~$")]
        for f in files:
            if f.lower().endswith(".mp3") and not f.startswith("~$"):
                found.append(os.path.join(root, f))

    def rank(p: str) -> tuple:
        rel = os.path.relpath(p, folder)
        in_audio = 0 if "音频" in rel else 1
        return (in_audio, len(rel), rel)

    found.sort(key=rank)
    return found


def compact_name(filename: str) -> str:
    stem = os.path.splitext(os.path.basename(filename))[0]
    stem = stem.replace("\u3000", " ").strip()
    stem = re.sub(r"^真题\s*\d+\s*", "", stem)
    stem = re.sub(r"^\d+\s+", "", stem)
    return re.sub(r"\s+", "", stem)


def classify_audio(path: str) -> tuple[str, str, int] | None:
    name = compact_name(path)
    m = re.match(r"^M([12])\.(\d+)$", name, re.I)
    if m:
        return f"m{m.group(1)}", "reply", int(m.group(2))
    m = re.search(r"M([12]).*对话回复(\d+)", name, re.I)
    if m:
        return f"m{m.group(1)}", "reply", int(m.group(2))
    m = re.search(r"M([12]).*短对话(\d+)", name, re.I)
    if m:
        return f"m{m.group(1)}", "convo", int(m.group(2))
    m = re.search(r"M([12]).*公告(\d+)", name, re.I)
    if m:
        return f"m{m.group(1)}", "announce", int(m.group(2))
    m = re.search(r"M([12]).*讲座(\d+)", name, re.I)
    if m:
        return f"m{m.group(1)}", "lecture", int(m.group(2))
    m = re.search(r"M([12]).*讲座$", name, re.I)
    if m:
        return f"m{m.group(1)}", "lecture", 1
    m = re.search(r"M([12]).*对话(\d+)", name, re.I)
    if m:
        return f"m{m.group(1)}", "convo", int(m.group(2))
    return None


def link_file(src: str, dst: str) -> None:
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if os.path.exists(dst):
        if os.path.getsize(dst) == os.path.getsize(src):
            return
        os.remove(dst)
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def set_number(folder_name: str) -> int:
    m = re.search(r"(\d+)\s*$", folder_name.replace("真题", " ").strip())
    if not m:
        m = re.search(r"(\d+)", folder_name)
    return int(m.group(1)) if m else 0


def audio_rel(paper_id: int, mod: str, kind: str, index: int) -> str:
    if kind == "reply":
        return f"audio/{paper_id}/{mod}-reply-{index:02d}.mp3"
    return f"audio/{paper_id}/{mod}-{kind}-{index}.mp3"


def attach_audio(paper: dict, folder: str) -> dict:
    stats = {"matched": 0, "files": 0, "unmatched": []}
    classified: dict[tuple, str] = {}
    for path in list_mp3(folder):
        stats["files"] += 1
        info = classify_audio(path)
        if not info:
            stats["unmatched"].append(os.path.basename(path))
            continue
        if info not in classified:
            classified[info] = path

    paper_id = paper["id"]
    for mod in paper["modules"]:
        for sec in mod["sections"]:
            kind = sec["kind"]
            if kind == "reply":
                for q in sec["questions"]:
                    src = classified.get((mod["id"], "reply", q["n"]))
                    if src:
                        rel = audio_rel(paper_id, mod["id"], "reply", q["n"])
                        link_file(src, os.path.join(PUBLIC, rel.replace("/", os.sep)))
                        q["audio"] = rel
                        stats["matched"] += 1
                    else:
                        q["audio"] = ""
            else:
                idx = sec.get("index") or 1
                src = classified.get((mod["id"], kind, idx))
                if not src and idx == 1:
                    for (m, k, i), p in classified.items():
                        if m == mod["id"] and k == kind:
                            src = p
                            break
                if src:
                    rel = audio_rel(paper_id, mod["id"], kind, idx)
                    link_file(src, os.path.join(PUBLIC, rel.replace("/", os.sep)))
                    sec["audio"] = rel
                    stats["matched"] += 1
                else:
                    sec["audio"] = ""
    return stats


def parse_paper(folder_name: str, folder: str) -> tuple[dict | None, dict]:
    files = os.listdir(folder)
    ans = pick_answer_doc(folder, files)
    if not ans:
        return None, {"error": "no answer doc"}
    lines = clean_lines(docx_paragraphs(ans))
    modules_raw = split_modules(lines)
    pid = set_number(folder_name)
    paper = {
        "id": pid,
        "title": f"真题 {pid}",
        "folder": folder_name,
        "sourceDoc": os.path.basename(ans),
        "modules": [],
    }
    for mid in ("m1", "m2"):
        secs = parse_module(mid, modules_raw.get(mid, []))
        if secs:
            paper["modules"].append(
                {"id": mid, "title": "Module 1" if mid == "m1" else "Module 2", "sections": secs}
            )
    vocab_path = pick_vocab_doc(folder, files)
    if vocab_path:
        groups = parse_vocab(vocab_path)
        all_secs = [s for m in paper["modules"] for s in m["sections"]]
        attach_vocab(all_secs, groups)
        paper["vocabAvailable"] = True
    else:
        paper["vocabAvailable"] = False

    audio_stats = attach_audio(paper, folder)
    nq = sum(len(s["questions"]) for m in paper["modules"] for s in m["sections"])
    nk = sum(
        1
        for m in paper["modules"]
        for s in m["sections"]
        for q in s["questions"]
        if q.get("answer")
    )
    stats = {
        "id": pid,
        "questions": nq,
        "withKey": nk,
        "audioHits": audio_stats["matched"],
        "audioFiles": audio_stats["files"],
        "source": os.path.basename(ans),
        "unmatchedAudio": audio_stats["unmatched"][:8],
        "sections": [s["title"] for m in paper["modules"] for s in m["sections"]],
    }
    return paper, stats


def main() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(AUDIO_DIR, exist_ok=True)
    papers = []
    report = []
    folders = [
        d
        for d in os.listdir(SOURCE)
        if os.path.isdir(os.path.join(SOURCE, d)) and "真题" in d
    ]
    folders.sort(key=set_number)
    for name in folders:
        paper, stats = parse_paper(name, os.path.join(SOURCE, name))
        report.append(stats)
        if paper:
            papers.append(paper)
            print(
                f"#{stats['id']:02d}  Q={stats['questions']:2d} key={stats['withKey']:2d} "
                f"audio={stats['audioHits']:2d}/{stats['audioFiles']:2d}  {stats['source']}",
                flush=True,
            )
        else:
            print(f"FAIL {name} {stats}", flush=True)

    papers.sort(key=lambda p: p["id"])
    payload = {
        "title": "真题前30 听力刷题",
        "count": len(papers),
        "papers": papers,
    }
    out = os.path.join(DATA_DIR, "papers.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(DATA_DIR, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\nWrote {len(papers)} papers -> {out}")
    print(f"Size {os.path.getsize(out)/1024:.0f} KB")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()

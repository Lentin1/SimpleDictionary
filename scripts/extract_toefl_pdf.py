#!/usr/bin/env python3
"""Convert the BEAT TOEFL PDF table into Vocab Flow's TXT import format.

The source PDF is a designed table rather than a plain text document.  We use
Poppler's XML output so that the word, phonetic, meaning, and part-of-speech
columns can be reconstructed even when a long word wraps across two lines.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import tempfile
import unicodedata
from pathlib import Path
from xml.etree import ElementTree


RADICALS = str.maketrans(
    {
        "⻓": "长",
        "⻝": "食",
        "⺠": "民",
        "⻔": "门",
        "⻋": "车",
        "⻛": "风",
        "⻅": "见",
        "⻣": "骨",
        "⻦": "鸟",
        "⻜": "飞",
        "⻆": "角",
        "⻥": "鱼",
        "⻄": "西",
        "⻘": "青",
        "⻰": "龙",
        "⻢": "马",
        "⻮": "齿",
        "⻉": "贝",
        "⻩": "黄",
        "⻁": "虎",
        "⻚": "页",
        "⻬": "齐",
        "⻤": "鬼",
    }
)
PART_TOKEN = r"(?:vt|vi|adj|adv|prep|conj|pron|aux|art|num|det|n|v)"
PART_PREFIX = re.compile(rf"^((?:(?:{PART_TOKEN})\.\s*)+)(.*)$", re.IGNORECASE)


def normalize(value: str) -> str:
    return unicodedata.normalize("NFKC", value).translate(RADICALS).replace("\u00a0", " ")


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", normalize(value)).strip()


def parse_parts(value: str) -> tuple[list[str], str]:
    match = PART_PREFIX.match(value)
    if not match:
        return [], value.strip()
    parts = [part.lower() for part in re.findall(rf"(?i){PART_TOKEN}\.", match.group(1))]
    return parts, match.group(2).strip()


def row_clusters(nodes: list[dict[str, int | str]], low: int, high: int, left: int, right: int) -> list[str]:
    selected = [node for node in nodes if low <= node["top"] < high and left <= node["left"] < right]
    clusters: list[list[dict[str, int | str]]] = []
    for node in sorted(selected, key=lambda item: (item["top"], item["left"])):
        if not clusters or node["top"] - clusters[-1][0]["top"] > 3:
            clusters.append([node])
        else:
            clusters[-1].append(node)
    return [
        clean("".join(str(node["raw"]) for node in sorted(cluster, key=lambda item: item["left"])))
        for cluster in clusters
    ]


def list_number(page: ElementTree.Element) -> int | None:
    for text in page.findall("text"):
        match = re.fullmatch(r"List\s+(\d{2})", clean("".join(text.itertext())))
        if match:
            return int(match.group(1))
    return None


def extract_entries(xml_path: Path) -> list[dict[str, object]]:
    root = ElementTree.parse(xml_path).getroot()
    entries: list[dict[str, object]] = []
    current_list: int | None = None

    for page in root.findall("page"):
        page_list = list_number(page)
        if page_list is not None:
            current_list = page_list
        if current_list is None:
            continue

        nodes = [
            {
                "top": int(text.attrib["top"]),
                "left": int(text.attrib["left"]),
                "raw": normalize("".join(text.itertext())),
            }
            for text in page.findall("text")
        ]
        starts: list[tuple[int, int, str]] = []
        for node in nodes:
            if node["left"] > 100:
                continue
            match = re.match(r"^\s*(\d{1,2})(?:\s+(.*?))?\s*$", str(node["raw"]))
            if match and 1 <= int(match.group(1)) <= 70:
                starts.append((int(match.group(1)), node["top"], (match.group(2) or "").strip()))

        for index, (number, top, inline) in enumerate(starts):
            next_top = starts[index + 1][1] if index + 1 < len(starts) else 2000
            low, high = top - 30, next_top - 30
            scope = [node for node in nodes if low <= node["top"] < high]

            word_nodes = [node for node in scope if 100 <= node["left"] < 200]
            word_fragment = clean("".join(str(node["raw"]).strip() for node in sorted(word_nodes, key=lambda item: (item["top"], item["left"]))))
            source = word_fragment or clean(inline)
            bracket = re.search(r"\[([^\]]*)\]", source)
            phonetic = ""
            word_after = ""
            if bracket:
                phonetic = f"[{clean(bracket.group(1))}]"
                word_after = source[bracket.end() :].strip()
                word = source[: bracket.start()].strip()
            else:
                word = source

            phonetic_rows = row_clusters(nodes, low, high, 180, 350)
            phonetic_source = " ".join(phonetic_rows).strip()
            phonetic_after = ""
            if not phonetic:
                bracket = re.search(r"\[([^\]]*)\]", phonetic_source)
                if bracket:
                    phonetic = f"[{clean(bracket.group(1))}]"
                    phonetic_after = phonetic_source[bracket.end() :].strip()
                else:
                    opening = phonetic_source.find("[")
                    if opening >= 0:
                        phonetic = f"[{phonetic_source[opening + 1 :].strip().rstrip(']')}]"

            meaning_rows = [row for row in row_clusters(nodes, low, high, 330, 550) if row and not re.fullmatch(r"\d+", row)]
            parts: list[str] = []
            meanings: list[str] = []
            for context in (word_after, phonetic_after):
                context_parts, context_tail = parse_parts(context)
                parts.extend(context_parts)
                context_tail = context_tail.strip(" ;；")
                if context_tail and (meanings or parts):
                    meanings.append(context_tail)
            for row in meaning_rows:
                row_parts, row_tail = parse_parts(row)
                row_tail = row_tail.strip(" ;；")
                if row_parts:
                    parts.extend(row_parts)
                    if row_tail:
                        meanings.append(row_tail)
                elif row_tail and (meanings or parts):
                    meanings.append(row_tail)

            unique_parts: list[str] = []
            for part in parts:
                if part not in unique_parts:
                    unique_parts.append(part)
            entries.append(
                {
                    "list": current_list,
                    "number": number,
                    "word": clean(word),
                    "phonetic": phonetic,
                    "part": " ".join(unique_parts),
                    "meaning": "；".join(meanings),
                }
            )

    expected = 30 * 70
    if len(entries) != expected:
        raise ValueError(f"expected {expected} entries, extracted {len(entries)}")
    for list_id in range(1, 31):
        list_entries = [entry for entry in entries if entry["list"] == list_id]
        numbers = {entry["number"] for entry in list_entries}
        if len(list_entries) != 70 or numbers != set(range(1, 71)):
            raise ValueError(f"List {list_id:02d} is incomplete")
    missing = [entry for entry in entries if not entry["word"] or not entry["phonetic"] or not entry["part"] or not entry["meaning"]]
    if missing:
        sample = ", ".join(f"List {entry['list']:02d} #{entry['number']}" for entry in missing[:5])
        raise ValueError(f"incomplete fields in {len(missing)} entries: {sample}")
    return entries


def convert(input_pdf: Path, output_txt: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="vocab-flow-pdf-") as temp_dir:
        xml_path = Path(temp_dir) / "source.xml"
        subprocess.run(
            ["pdftohtml", "-xml", "-i", "-nodrm", str(input_pdf), str(xml_path)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        entries = extract_entries(xml_path)

    lines = [
        "# 2026 BEAT《托福必考2000词》List 01-30",
        "# 格式：单词 | 音标 | 中文释义 | 词性 | 例句（可选）",
        "# PDF 原文未提供例句，因此例句字段暂留空。",
    ]
    for entry in entries:
        if entry["number"] == 1:
            lines.append("")
            lines.append(f"[List {entry['list']:02d}]")
        lines.append(f"{entry['word']} | {entry['phonetic']} | {entry['meaning']} | {entry['part']} |")
    output_txt.parent.mkdir(parents=True, exist_ok=True)
    output_txt.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {len(entries)} entries to {output_txt}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True, help="source PDF")
    parser.add_argument("--output", type=Path, required=True, help="Vocab Flow TXT output")
    args = parser.parse_args()
    convert(args.input, args.output)


if __name__ == "__main__":
    main()

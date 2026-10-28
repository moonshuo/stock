import ast
import argparse
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests


ROOT = Path(__file__).resolve().parent.parent
TAXONOMY_PATH = ROOT / "data" / "sector_taxonomy.json"
QSTOCK_UTIL_PATH = (
    ROOT / ".ths-py312" / "Lib" / "site-packages" / "qstock" / "data" / "util.py"
)
OUTPUT_PATH = ROOT / "data" / "imports" / "ths_fine_industry_snapshot.json"
JINA_PREFIX = "https://r.jina.ai/http://q.10jqka.com.cn"
MAX_WORKERS = 3


parser = argparse.ArgumentParser()
parser.add_argument(
    "--codes",
    help="仅抓取指定同花顺细分行业代码，多个代码用英文逗号分隔",
)
args = parser.parse_args()
requested_codes = {
    item.strip()
    for item in (args.codes or "").split(",")
    if item.strip()
}


def normalize(value):
    text = str(value or "").strip()
    text = re.sub(r"[ⅠⅡⅢIVX]+$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"(行业|板块|产业链)$", "", text)
    return re.sub(r"[（）()、，,\s/·\-—]", "", text).strip()


def load_ths_industries():
    tree = ast.parse(QSTOCK_UTIL_PATH.read_text(encoding="utf-8"))
    mapping = next(
        ast.literal_eval(node.value)
        for node in tree.body
        if isinstance(node, ast.Assign)
        and any(
            isinstance(target, ast.Name) and target.id == "ths_code_name"
            for target in node.targets
        )
    )
    return [
        {"code": code, "name": name}
        for code, name in mapping.items()
        if str(code).startswith("884")
    ]


def taxonomy_candidates():
    taxonomy = json.loads(TAXONOMY_PATH.read_text(encoding="utf-8"))
    secondary = []
    tertiary = []
    for primary in taxonomy.get("sectors", []):
        for second in primary.get("secondary_sectors", []):
            secondary.append(
                {
                    "name": second["name"],
                    "primary": primary["name"],
                    "secondary": second["name"],
                }
            )
            for third in second.get("tertiary_sectors", []):
                tertiary.append(
                    {
                        "name": third,
                        "primary": primary["name"],
                        "secondary": second["name"],
                        "tertiary": third,
                    }
                )
    return secondary, tertiary


def unique_match(source_name, candidates, exact_only=False):
    source = normalize(source_name)
    exact = [item for item in candidates if normalize(item["name"]) == source]
    if len(exact) == 1:
        return exact[0]
    if exact_only or not source or "其他" in source:
        return None
    fuzzy = [
        item
        for item in candidates
        if min(len(source), len(normalize(item["name"]))) >= 2
        and (
            source in normalize(item["name"])
            or normalize(item["name"]) in source
        )
    ]
    return fuzzy[0] if len(fuzzy) == 1 else None


def resolve_target(industry, secondary_candidates, tertiary_candidates):
    # Exact secondary matches take priority over fuzzy tertiary matches. This is
    # what makes "半导体设备" land in "半导体设备 / 未分类".
    tertiary = unique_match(industry["name"], tertiary_candidates, exact_only=True)
    if tertiary:
        return {**tertiary, "resolution": "明确三级匹配"}
    secondary = unique_match(industry["name"], secondary_candidates, exact_only=True)
    if secondary:
        return {
            **secondary,
            "tertiary": "未分类",
            "resolution": "仅确定二级，归入未分类",
        }
    tertiary = unique_match(industry["name"], tertiary_candidates)
    if tertiary:
        return {**tertiary, "resolution": "唯一名称包含匹配"}
    secondary = unique_match(industry["name"], secondary_candidates)
    if secondary:
        return {
            **secondary,
            "tertiary": "未分类",
            "resolution": "仅确定二级，归入未分类",
        }
    return None


def parse_rows(markdown):
    stocks = []
    row_pattern = re.compile(
        r"^\|\s*\d+\s*\|\s*\[(\d{6})\]\([^)]*\)\s*\|\s*\[([^\]]+)\]",
        re.MULTILINE,
    )
    for code, name in row_pattern.findall(markdown):
        stocks.append({"code": code, "name": name.strip()})
    return stocks


def get_markdown(url, session):
    last_error = None
    for attempt in range(4):
        try:
            response = session.get(url, timeout=90)
            if response.status_code == 429:
                time.sleep(15 * (attempt + 1))
                continue
            response.raise_for_status()
            return response.text
        except Exception as error:
            last_error = error
            time.sleep(4 * (attempt + 1))
    raise RuntimeError(str(last_error))


def fetch_industry(industry, target):
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0"})
    code = industry["code"]
    stocks_by_code = {}
    pages = 0
    for page in range(1, 30):
        if page == 1:
            source_url = f"http://q.10jqka.com.cn/thshy/detail/code/{code}/"
        else:
            source_url = (
                "http://q.10jqka.com.cn/thshy/detail/"
                f"field/199112/order/desc/page/{page}/ajax/1/code/{code}"
            )
        markdown = get_markdown(f"https://r.jina.ai/{source_url}", session)
        rows = parse_rows(markdown)
        if not rows:
            break
        pages += 1
        before = len(stocks_by_code)
        for stock in rows:
            stocks_by_code[stock["code"]] = stock
        if len(rows) < 20 or len(stocks_by_code) == before:
            break
        time.sleep(0.4)
    return {
        **industry,
        "source_url": f"http://q.10jqka.com.cn/thshy/detail/code/{code}/",
        "target": target,
        "pages": pages,
        "constituents": list(stocks_by_code.values()),
    }


industries = load_ths_industries()
if requested_codes:
    industries = [
        industry for industry in industries if industry["code"] in requested_codes
    ]
secondary_candidates, tertiary_candidates = taxonomy_candidates()
fetchable = []
unresolved = []
for industry in industries:
    target = resolve_target(industry, secondary_candidates, tertiary_candidates)
    if target:
        fetchable.append((industry, target))
    else:
        unresolved.append(
            {
                **industry,
                "reason": "无法唯一映射到现有二级或三级目录，未抓取、未写入",
            }
        )

print(
    f"同花顺细分行业 {len(industries)} 个；"
    f"安全映射 {len(fetchable)} 个；跳过 {len(unresolved)} 个。",
    flush=True,
)

results = []
errors = []
with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
    futures = {
        executor.submit(fetch_industry, industry, target): industry
        for industry, target in fetchable
    }
    for index, future in enumerate(as_completed(futures), 1):
        industry = futures[future]
        try:
            result = future.result()
            results.append(result)
        except Exception as error:
            errors.append({**industry, "error": str(error)})
        if index % 10 == 0 or index == len(futures):
            print(
                f"已完成 {index}/{len(futures)}，失败 {len(errors)}。",
                flush=True,
            )

results.sort(key=lambda item: item["code"])
snapshot = {
    "source": "同花顺细分行业",
    "source_index": "qstock 内置同花顺 884 行业代码表",
    "fetch_proxy": "Jina Reader（读取同花顺公开行业详情页）",
    "fetched_at": datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(),
    "industries": results,
    "unresolved_industries": unresolved,
    "errors": errors,
}
OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
OUTPUT_PATH.write_text(
    json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
print(
    f"完成：{len(results)} 个行业，"
    f"{sum(len(item['constituents']) for item in results)} 条成分记录，"
    f"{len(errors)} 个失败。",
    flush=True,
)
print(OUTPUT_PATH, flush=True)

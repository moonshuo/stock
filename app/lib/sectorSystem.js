export function normalizeCode(value = "") {
  return String(value).replace(/\D/g, "").padStart(6, "0").slice(-6);
}

// 东方财富的 m:0+t:80 结果中混有老三板和新三板证券。它们不属于
// 本应用要做长期产业分类的 A 股股票池，不能进入全市场 GPT 核验批次。
export function isThirdBoardStockCode(value = "") {
  return /^(?:4|8)\d{5}$/.test(normalizeCode(value));
}

export function isStStockName(name = "") {
  return /^(?:\*?ST|S\*ST|SST|退)/i.test(String(name || "").trim());
}

export function uniqueByCode(stocks) {
  const seen = new Map();
  for (const stock of stocks) {
    if (!seen.has(stock.code)) seen.set(stock.code, stock);
  }
  return Array.from(seen.values());
}

// 兼容旧数据：旧记录把一级主线放在股票本身；新记录允许每条二级归属拥有自己的一级主线。
export function classificationPrimarySector(stock, classification) {
  return classification?.primary_sector || classification?.primarySector || stock?.primary_sector || "";
}

export function stockPrimarySectors(stock) {
  const sectors = (stock?.classifications || [])
    .map((classification) => classificationPrimarySector(stock, classification))
    .filter(Boolean);
  return Array.from(new Set(sectors.length ? sectors : [stock?.primary_sector].filter(Boolean)));
}

export function buildTaxonomyLookups(taxonomy) {
  const primary = new Map();
  const secondary = new Map();
  const tertiary = new Map();

  for (const sector of taxonomy?.sectors || []) {
    primary.set(sector.name, sector);
    for (const secondarySector of sector.secondary_sectors || []) {
      secondary.set(`${sector.name}|${secondarySector.name}`, secondarySector);
      for (const tertiarySector of secondarySector.tertiary_sectors || []) {
        tertiary.set(`${sector.name}|${secondarySector.name}|${tertiarySector}`, tertiarySector);
      }
    }
  }

  return { primary, secondary, tertiary };
}

export function buildRuntimeIndexes(taxonomy, stockMap) {
  const primarySectorIndex = new Map();
  const secondarySectorIndex = new Map();
  const tertiarySectorIndex = new Map();
  const productTagIndex = new Map();
  const stockCodeIndex = new Map();

  for (const stock of stockMap?.stocks || []) {
    stockCodeIndex.set(stock.code, stock);

    for (const classification of stock.classifications || []) {
      const primaryKey = classificationPrimarySector(stock, classification);
      if (!primarySectorIndex.has(primaryKey)) primarySectorIndex.set(primaryKey, new Map());
      primarySectorIndex.get(primaryKey).set(stock.code, stock);
      const secondaryKey = `${primaryKey}|${classification.secondary_sector}`;
      if (!secondarySectorIndex.has(secondaryKey)) secondarySectorIndex.set(secondaryKey, new Map());
      secondarySectorIndex.get(secondaryKey).set(stock.code, stock);

      for (const tertiary of classification.tertiary_sectors || []) {
        const tertiaryKey = `${primaryKey}|${classification.secondary_sector}|${tertiary}`;
        if (!tertiarySectorIndex.has(tertiaryKey)) tertiarySectorIndex.set(tertiaryKey, new Map());
        tertiarySectorIndex.get(tertiaryKey).set(stock.code, stock);
      }
    }

    for (const tag of stock.product_tags || []) {
      if (!productTagIndex.has(tag)) productTagIndex.set(tag, new Map());
      productTagIndex.get(tag).set(stock.code, stock);
    }
  }

  return {
    primarySectorIndex,
    secondarySectorIndex,
    tertiarySectorIndex,
    productTagIndex,
    stockCodeIndex
  };
}

export function indexList(index, key) {
  return Array.from(index.get(key)?.values() || []);
}

export function validateSectorData(taxonomy, stockMap, dailyThemes = []) {
  const errors = [];
  const warnings = [];
  const lookups = buildTaxonomyLookups(taxonomy);
  const seenStockClassifications = new Set();
  const seenCodes = new Map();

  // 产业书页可以暂时没有一级主线；仅要求数据字段本身是数组。
  if (!Array.isArray(taxonomy?.sectors)) {
    errors.push("sector_taxonomy.json: sectors 必须为数组");
  }

  for (const sector of taxonomy?.sectors || []) {
    if (!sector.name) errors.push("sector_taxonomy.json: 一级主线名称不能为空");
    if (!Array.isArray(sector.secondary_sectors) || sector.secondary_sectors.length === 0) {
      warnings.push(`sector_taxonomy.json: ${sector.name || "未命名一级"} 暂无二级产业环节`);
    }
    for (const secondary of sector.secondary_sectors || []) {
      if (!secondary.name) errors.push(`sector_taxonomy.json: ${sector.name} 存在空二级名称`);
      if (!Array.isArray(secondary.tertiary_sectors) || secondary.tertiary_sectors.length === 0) {
        warnings.push(`sector_taxonomy.json: ${sector.name}/${secondary.name || "未命名二级"} 暂无三级产品方向`);
      }
      const duplicates = secondary.tertiary_sectors.filter((item, index, arr) => arr.indexOf(item) !== index);
      for (const item of duplicates) {
        errors.push(`sector_taxonomy.json: ${sector.name}/${secondary.name} 重复三级分类 ${item}`);
      }
      for (const tertiary of secondary.tertiary_sectors || []) {
        if (!tertiary) errors.push(`sector_taxonomy.json: ${sector.name}/${secondary.name} 存在空三级名称`);
      }
    }
  }

  for (const stock of stockMap?.stocks || []) {
    const location = `${stock.code || "空代码"} ${stock.name || "未命名"}`;
    if (!/^\d{6}$/.test(stock.code || "")) {
      errors.push(`stock_sector_map.json: ${location} 股票代码必须为6位数字`);
    }
    if (seenCodes.has(stock.code) && seenCodes.get(stock.code) !== stock.name) {
      warnings.push(`stock_sector_map.json: ${stock.code} 名称不一致：${seenCodes.get(stock.code)} / ${stock.name}`);
    }
    seenCodes.set(stock.code, stock.name);

    if (!Array.isArray(stock.classifications) || stock.classifications.length === 0) {
      errors.push(`stock_sector_map.json: ${location} classifications 不能为空`);
    }

    for (const classification of stock.classifications || []) {
      const primarySector = classificationPrimarySector(stock, classification);
      if (!lookups.primary.has(primarySector)) {
        errors.push(`stock_sector_map.json: ${location} primary_sector 不存在：${primarySector || "空"}`);
      }
      const secondaryKey = `${primarySector}|${classification.secondary_sector}`;
      if (!lookups.secondary.has(secondaryKey)) {
        errors.push(`stock_sector_map.json: ${location} 二级不属于对应一级：${primarySector}/${classification.secondary_sector || "空"}`);
      }
      if (!Array.isArray(classification.tertiary_sectors) || classification.tertiary_sectors.length === 0) {
        errors.push(`stock_sector_map.json: ${location} ${classification.secondary_sector || "空二级"} 缺少三级归属`);
      }
      const relevanceScore = Number(classification.relevance_score);
      if (!Number.isFinite(relevanceScore)) {
        errors.push(`stock_sector_map.json: ${location} ${primarySector}/${classification.secondary_sector || "空二级"} 缺少 relevance_score`);
      } else if (relevanceScore < 0 || relevanceScore > 1) {
        errors.push(`stock_sector_map.json: ${location} ${primarySector}/${classification.secondary_sector || "空二级"} relevance_score 必须介于 0 和 1`);
      }
      for (const tertiary of classification.tertiary_sectors || []) {
        const tertiaryKey = `${primarySector}|${classification.secondary_sector}|${tertiary}`;
        if (!lookups.tertiary.has(tertiaryKey)) {
          errors.push(`stock_sector_map.json: ${location} 三级不属于对应二级：${tertiaryKey}`);
        }
        const uniqueKey = `${stock.code}|${primarySector}|${classification.secondary_sector}|${tertiary}`;
        if (seenStockClassifications.has(uniqueKey)) {
          errors.push(`stock_sector_map.json: ${location} 重复分类：${classification.secondary_sector}/${tertiary}`);
        }
        seenStockClassifications.add(uniqueKey);
      }
    }

    const tags = stock.product_tags || [];
    const uniqueTags = new Set(tags);
    if (tags.length !== uniqueTags.size) {
      warnings.push(`stock_sector_map.json: ${location} product_tags 存在重复，运行保存后会去重`);
    }
  }

  for (const daily of dailyThemes) {
    for (const theme of daily.themes || []) {
      if (!lookups.primary.has(theme.primary_sector)) {
        errors.push(`${daily.date}: 动态题材 ${theme.name} primary_sector 不存在：${theme.primary_sector}`);
      }
      const archivedPaths = Array.isArray(theme.unmapped_paths);
      if (!theme.secondary_sector && !archivedPaths) {
        errors.push(`${daily.date}: 动态题材 ${theme.name} 缺少 secondary_sector`);
      }
      if (theme.secondary_sector) {
        const secondaryKey = `${theme.primary_sector}|${theme.secondary_sector}`;
        if (!lookups.secondary.has(secondaryKey)) {
          errors.push(`${daily.date}: 动态题材 ${theme.name} secondary_sector 不存在：${secondaryKey}`);
        }
        for (const tertiary of theme.related_tertiary_sectors || []) {
          const tertiaryKey = `${theme.primary_sector}|${theme.secondary_sector}|${tertiary}`;
          if (!lookups.tertiary.has(tertiaryKey)) {
            errors.push(`${daily.date}: 动态题材 ${theme.name} related_tertiary_sector 不存在：${tertiaryKey}`);
          }
        }
      } else if ((theme.related_tertiary_sectors || []).length) {
        errors.push(`${daily.date}: 动态题材 ${theme.name} 未关联目录时不能保留 related_tertiary_sectors`);
      }
      for (const code of theme.stocks || []) {
        if (!/^\d{6}$/.test(code)) {
          errors.push(`${daily.date}: 动态题材 ${theme.name} 股票代码必须为6位数字：${code}`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function sanitizeStockMap(stockMap) {
  return {
    version: stockMap?.version || "1.0",
    stocks: (stockMap?.stocks || []).map((stock) => ({
      ...stock,
      code: normalizeCode(stock.code),
      name: String(stock.name || ""),
      primary_sector: String(stock.primary_sector || ""),
      classifications: (stock.classifications || []).map((classification) => ({
        ...(classification.primary_sector || classification.primarySector ? { primary_sector: String(classification.primary_sector || classification.primarySector) } : {}),
        secondary_sector: String(classification.secondary_sector || ""),
        tertiary_sectors: Array.from(new Set(classification.tertiary_sectors || [])),
        ...(Number.isFinite(Number(classification.relevance_score)) ? { relevance_score: Math.max(0, Math.min(1, Number(classification.relevance_score))) } : {}),
        ...(Array.isArray(classification.source_refs) ? { source_refs: Array.from(new Set(classification.source_refs.map(String).filter(Boolean))) } : {}),
        ...(classification.verification_note ? { verification_note: String(classification.verification_note) } : {})
      })),
      product_tags: Array.from(new Set(stock.product_tags || [])),
      reason: String(stock.reason || "")
    }))
  };
}

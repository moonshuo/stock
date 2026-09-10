function finiteChange(value) {
  if (value === null || value === undefined || value === "") return null;
  const change = Number(value);
  return Number.isFinite(change) ? change : null;
}

export function sortByMarketChange(items = [], getChange) {
  return items
    .map((item, index) => ({ item, index, change: finiteChange(getChange(item)) }))
    .sort((left, right) => {
      if (left.change === null) return right.change === null ? left.index - right.index : 1;
      if (right.change === null) return -1;
      return right.change - left.change || left.index - right.index;
    })
    .map(({ item }) => item);
}

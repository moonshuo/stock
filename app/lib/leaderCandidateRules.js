function limitDownThreshold(code = "") {
  const normalized = String(code).replace(/\D/g, "").padStart(6, "0").slice(-6);
  if (/^(300|301|688|689)/.test(normalized)) return -19.5;
  if (/^(4|8)/.test(normalized)) return -29;
  return -9.5;
}

export function postSurgeCollapseEvidence(code, history = []) {
  const returns = history.map((row) => Number(row?.return_pct)).filter(Number.isFinite);
  const trailing = returns.slice(-3);
  let trailingLimitDownDays = 0;
  for (const value of [...returns].reverse()) {
    if (value > limitDownThreshold(code)) break;
    trailingLimitDownDays += 1;
  }
  const trailingLossDays = [...returns].reverse().findIndex((value) => value >= 0);
  const consecutiveLossDays = trailingLossDays < 0 ? returns.length : trailingLossDays;
  const recent3Return = trailing.reduce((total, value) => total * (1 + value / 100), 1) - 1;
  const collapsed = trailingLimitDownDays >= 2 || (consecutiveLossDays >= 3 && trailing.length === 3 && recent3Return <= -0.2);
  return {
    collapsed,
    trailingLimitDownDays,
    consecutiveLossDays,
    recent3ReturnPct: +(recent3Return * 100).toFixed(2),
  };
}

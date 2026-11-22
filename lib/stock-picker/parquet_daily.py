"""Offline daily aggregation for one explicit date. No calendar traversal, names lookup or network."""
import sys,json
import numpy as np
import pandas as pd
import pyarrow.parquet as pq

def daily(file,date):
    fields=['code','date','trade_time','open','high','low','close','pre_close','vol','amount']
    raw=pq.read_table(file, columns=fields).to_pandas(ignore_metadata=True)
    raw['code']=raw.code.astype(str).str.extract(r'^(\d{6})(?:\.(?:SZ|SH|BJ))?$',expand=False)
    raw=raw[raw.code.notna()].copy()
    if not raw.date.astype(str).str.replace('-','',regex=False).eq(date.replace('-','')).all():raise ValueError('cross-date rows')
    ts=pd.to_datetime(raw.trade_time,errors='raise');
    if not ts.dt.strftime('%Y-%m-%d').eq(date).all():raise ValueError('cross-date clock')
    raw['clock']=ts.dt.hour*60+ts.dt.minute
    dup=set(raw.loc[raw.duplicated(['code','trade_time'],keep=False),'code'])
    raw.sort_values(['code','clock'],inplace=True)
    numeric=['open','high','low','close','pre_close','vol','amount']; raw[numeric]=raw[numeric].apply(pd.to_numeric,errors='coerce').astype('float64')
    prices=raw[['open','high','low','close','pre_close']]; bad=(~np.isfinite(raw[numeric])).any(axis=1)|prices.le(0).any(axis=1)|raw.vol.lt(0)|raw.amount.lt(0)|raw.high.lt(prices[['open','low','close']].max(axis=1))|raw.low.gt(prices[['open','high','close']].min(axis=1))
    grp=raw.groupby('code',sort=True); n=grp.size(); first=grp.clock.first(); last=grp.clock.last()
    singles=set(n.index[(n==1)&(first>=900)]); minutes=set(n.index[(first==570)&(last>=900)])
    # Never sum repeated cumulative snapshots. Require all 49 regular five-minute bars, incl opening auction.
    intraday=raw.loc[raw.code.isin(minutes)&raw.clock.le(900)].copy(); full=set(range(570,691,5))|set(range(785,901,5)); counts=intraday.groupby('code').size()
    irregular=set(intraday.loc[~intraday.clock.isin(full),'code']); minutes &= set(counts.index[counts==len(full)])-irregular
    usable=(singles|minutes)-dup-set(raw.loc[bad,'code']); selected=raw[raw.code.isin(usable)&(raw.clock.le(900)|raw.code.isin(singles))]; out=selected.groupby('code',sort=True).agg(open=('open','first'),high=('high','max'),low=('low','min'),close=('close','last'),preClose=('pre_close','first'),volume=('vol','sum'),amount=('amount','sum')).reset_index()
    # Parquet often stores float32; normalize A-share quoted prices to their exchange tick.
    equities=out.code.str.match(r'^(?:00|30|60|68|4|8|92)'); pc=['open','high','low','close','preClose']
    out[pc]=out[pc].astype('float64');out.loc[equities,pc]=out.loc[equities,pc].round(2)
    # Volume unit is not guaranteed across source formats; keep raw volume for tradability only.
    # No dated security names in the source; never infer historical ST status from the latest mapping.
    return {'date':date,'status':'ok' if len(out) else 'unavailable','excluded_codes':len(n)-len(out),'columns':list(out.columns),'rows':out.values.tolist()}
if __name__=='__main__':
    json.dump(daily(sys.argv[1],sys.argv[2]),sys.stdout,allow_nan=False,ensure_ascii=True,separators=(',',':'))

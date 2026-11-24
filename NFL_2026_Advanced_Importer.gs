/**
 * NFL EPA DELTA — replace the contents of the existing bound Apps Script
 * NFL_2026_Advanced_Importer.gs file with this script.
 *
 * Reads only the compact GitHub team-game feed, never the season PBP CSV.
 * Preserves prior stage records, existing main-sheet values/formulas,
 * historical results, odds, and frozen betting snapshots.
 */
const NFL26 = {
  season: 2026,
  feedUrl: 'https://raw.githubusercontent.com/doctorbb2b/nfl-epa-feed/main/data/nfl_2026_team_games.csv',
  stage: '_NFL_2026_PBP_GAME_STATS',
  columns: [
    'season','week','game_id','game_date','team','opponent','side','plays',
    'off_epa_per_play','def_epa_per_play_allowed','off_success_rate','def_success_rate_allowed',
    'off_pass_epa_per_dropback','def_pass_epa_per_dropback_allowed',
    'off_rush_epa_per_rush','def_rush_epa_per_rush_allowed',
    'off_explosive_pass_rate','def_explosive_pass_rate_allowed',
    'off_explosive_rush_rate','def_rush_epa_per_rush_allowed',
    'off_explosive_rush_rate','def_explosive_rush_rate_allowed',
    'off_sack_rate_allowed','def_sack_rate_generated','off_cpoe','def_cpoe_allowed',
    'off_first_down_rate','def_first_down_rate_allowed'
  ],
  aliases: { WASH:'WAS', WSH:'WAS', JAC:'JAX', LA:'LAR', STL:'LAR', SD:'LAC', OAK:'LV' }
};
// Replace the column specification above with the exact 26-column stage header.
NFL26.columns = [
  'season','week','game_id','game_date','team','opponent','side','plays',
  'off_epa_per_play','def_epa_per_play_allowed','off_success_rate','def_success_rate_allowed',
  'off_pass_epa_per_dropback','def_pass_epa_per_dropback_allowed',
  'off_rush_epa_per_rush','def_rush_epa_per_rush_allowed',
  'off_explosive_pass_rate','def_explosive_pass_rate_allowed',
  'off_explosive_rush_rate','def_explosive_rush_rate_allowed',
  'off_sack_rate_allowed','def_sack_rate_generated','off_cpoe','def_cpoe_allowed',
  'off_first_down_rate','def_first_down_rate_allowed'
];

function NFL26_team_(x) {
  const s = String(x || '').trim().toUpperCase();
  return NFL26.aliases[s] || s;
}
function NFL26_date_(x) {
  if (x instanceof Date) return Utilities.formatDate(x,'America/New_York','yyyy-MM-dd');
  const s = String(x || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  const p = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return p ? p[3]+'-'+p[1].padStart(2,'0')+'-'+p[2].padStart(2,'0') : '';
}
function NFL26_metric_(x) {
  if (x === '' || x == null) return '';
  const n = Number(x);
  if (!Number.isFinite(n)) throw new Error('Non-numeric EPA feed value: '+x);
  return n;
}
function NFL26_same_(a,b) {
  if ((a===''||a==null)&&(b===''||b==null)) return true;
  if (a===''||b===''||a==null||b==null) return false;
  if (isFinite(Number(a)) && isFinite(Number(b))) return Math.abs(Number(a)-Number(b))<1e-7;
  return String(a)===String(b);
}

/** Append previously missing game/team records; update recent corrected stage records only. */
function NFL_refresh2026() {
  const response=UrlFetchApp.fetch(NFL26.feedUrl,{followRedirects:true,muteHttpExceptions:true});
  if (response.getResponseCode()!==200)
    throw Error('EPA FEED HTTP '+response.getResponseCode()+': '+NFL26.feedUrl);
  const parsed=Utilities.parseCsv(response.getContentText());
  const header=parsed.shift()||[];
  if (header.length!==26 || NFL26.columns.some((c,i)=>c!==String(header[i]).trim()))
    throw Error('EPA FEED SCHEMA MISMATCH — stage untouched');
  const source=[], seen=new Set(), byGame=new Map();
  for(const raw of parsed) {
    if(raw.length===1 && raw[0]==='') continue;
    if(raw.length!==26) throw Error('Malformed 26-column source record');
    const row=raw.map((v,i)=>[0,1,7].includes(i)||i>=8?NFL26_metric_(v):String(v).trim());
    if(row[0]!==2026 || !/^\d{4}-\d{2}-\d{2}$/.test(row[3]) ||
       !row[2] || !row[4] || !row[5] || !['H','A'].includes(row[6]) ||
       !Number.isFinite(row[8]) || !Number.isFinite(row[9]))
      throw Error('Invalid EPA source record identity or primary metric');
    const key=row[2]+'|'+row[4];
    if(seen.has(key)) throw Error('Duplicate EPA source game/team '+key);
    seen.add(key); source.push(row);
    if(!byGame.has(row[2])) byGame.set(row[2],[]);
    byGame.get(row[2]).push(row);
  }
  if(!source.length) throw Error('EPA SOURCE EMPTY; existing data preserved');
  for(const [gid,pair] of byGame) {
    if(pair.length!==2||pair[0][6]===pair[1][6]||
       pair[0][3]!==pair[1][3]||pair[0][4]!==pair[1][5]||
       pair[1][4]!==pair[0][5])
      throw Error('Incomplete or non-reciprocal game '+gid);
  }
  const ss=SpreadsheetApp.getActiveSpreadsheet(),stage=ss.getSheetByName(NFL26.stage);
  if(!stage) throw Error('NFL EPA stage tab missing');
  const oldHeader=stage.getRange(1,1,1,26).getValues()[0];
  if(NFL26.columns.some((c,i)=>String(oldHeader[i]).trim()!==c))
    throw Error('Original stage header changed; no writes');
  const oldN=Math.max(0,stage.getLastRow()-1);
  const old=oldN?stage.getRange(2,1,oldN,26).getValues():[];
  const existing=new Map();
  old.forEach((row,i)=>{
    if(!row[2]||!row[4]) return;
    const key=row[2]+'|'+row[4];
    if(existing.has(key)) throw Error('Duplicate existing stage key '+key);
    existing.set(key,{row,index:i+2});
  });
  const latestOld=old.reduce((best,row)=>{const date=NFL26_date_(row[3]);return date>best?date:best;},'');
  const latestNew=source.reduce((best,row)=>row[3]>best?row[3]:best,'');
  if(latestNew<latestOld) throw Error('EPA FEED STALE: '+latestNew+' < '+latestOld);
  const cutoff=Utilities.formatDate(new Date(Date.now()-14*86400000),'America/New_York','yyyy-MM-dd');
  const append=[],corrections=[];
  for(const row of source) {
    const prev=existing.get(row[2]+'|'+row[4]);
    if(!prev) { append.push(row);continue; }
    if(row[3]>=cutoff && row.some((v,i)=>!NFL26_same_(v,prev.row[i])))
      corrections.push({index:prev.index,row});
  }
  for(const x of corrections) stage.getRange(x.index,1,1,26).setValues([x.row]);
  if(append.length) stage.getRange(stage.getLastRow()+1,1,append.length,26).setValues(append);
  SpreadsheetApp.flush();
  PropertiesService.getScriptProperties().setProperty('NFL_2026_FEED_LAST_DATE',latestNew);
  PropertiesService.getScriptProperties().setProperty('NFL_2026_LAST_REFRESH',new Date().toISOString());
  Logger.log('NFL EPA FEED OK | source team rows='+source.length+' appended='+append.length+
             ' corrected='+corrections.length+' latest='+latestNew);
  return {sourceRows:source.length,appended:append.length,corrected:corrections.length,latestDate:latestNew};
}

/** Fill ONLY missing 2026!AM:BD metrics for settled games; never replace existing formulas. */
function NFL26_DELTA_connect() {
  const ss=SpreadsheetApp.getActiveSpreadsheet(), main=ss.getSheetByName('2026'),
        stage=ss.getSheetByName(NFL26.stage);
  if(!main||!stage) throw Error('Missing NFL main or stage sheet');
  const n=Math.min(547,main.getLastRow())-3;
  if(n<=0) return {filled:0,unmatched:[]};
  const identity=main.getRange(4,1,n,4).getValues();
  const flags=main.getRange(4,10,n,2).getValues();
  const target=main.getRange(4,39,n,18),values=target.getValues(),formulas=target.getFormulas();
  const stageData=stage.getRange(2,1,stage.getLastRow()-1,26).getValues();
  const records=new Map();
  for(const row of stageData) {
    const key=NFL26_date_(row[3])+'|'+NFL26_team_(row[4])+'|'+
              NFL26_team_(row[5])+'|'+row[6];
    if(records.has(key)) throw Error('Duplicate source matchup '+key);
    records.set(key,row);
  }
  const coverageSince=Utilities.formatDate(new Date(Date.now()-14*86400000),'America/New_York','yyyy-MM-dd');
  let filled=0;
  const unmatched=[];
  for(let i=0;i<n;i++) {
    if(!/^[WLT]$/.test(String(flags[i][0])) || !Number.isFinite(Number(identity[i][2]))) continue;
    const side=flags[i][1];
    if(!['A','H'].includes(side)) continue;
    const opp=side==='A'?i+1:i-1;
    if(opp<0||opp>=n||flags[opp][1]===side||
       NFL26_date_(identity[i][0])!==NFL26_date_(identity[opp][0])) continue;
    const key=NFL26_date_(identity[i][0])+'|'+NFL26_team_(identity[i][1])+'|'+
              NFL26_team_(identity[opp][1])+'|'+side;
    const rec=records.get(key);
    if(!rec) {
      if(NFL26_date_(identity[i][0])>=coverageSince) unmatched.push(key);
      continue;
    }
    for(let j=0;j<18;) {
      if(formulas[i][j] || (values[i][j]!==''&&values[i][j]!=null) ||
         rec[j+8]===''||rec[j+8]==null) {j++;continue;}
      const start=j,batch=[];
      while(j<18&&!formulas[i][j]&&(values[i][j]===''||values[i][j]==null)&&
            rec[j+8]!==''&&rec[j+8]!=null) {
        batch.push(Number(rec[j+8]));
        j++;
      }
      main.getRange(i+4,39+start,1,batch.length).setValues([batch]);
      filled+=batch.length;
    }
  }
  SpreadsheetApp.flush();
  Logger.log('NFL EPA CONNECT | AM:BD filled='+filled+' unmatched='+unmatched.length+
             (unmatched.length?' | '+unmatched.slice(0,12).join('; '):''));
  return {filled,unmatched};
}
function NFL26_DELTA_run() {
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(1000)) throw Error('EPA import already running');
  try {
    const imported=NFL_refresh2026(),joined=NFL26_DELTA_connect();
    if(joined.unmatched.length)
      throw Error('EPA COVERAGE INCOMPLETE: '+joined.unmatched.join('; '));
    return {imported,joined};
  } finally {lock.releaseLock();}
}
function NFL26_DELTA_install() {
  const fn='NFL26_DELTA_run';
  const found=ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()===fn);
  if(!found) ScriptApp.newTrigger(fn).timeBased().everyDays(1)
                          .atHour(8).inTimezone('America/New_York').create();
  return NFL26_DELTA_run();
}

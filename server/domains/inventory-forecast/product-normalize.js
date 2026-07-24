// Product name normalization for inventory forecast
// Maps variant names like "9秒生炒魚片【地道鲜嫩廣府味】" → "九秒生炒鱼片"

const _TRAD_TO_SIMP = {'魚':'鱼','雞':'鸡','鴨':'鸭','豬':'猪','牛':'牛','蝦':'虾','蠔':'蚝','鵝':'鹅','雜':'杂','滷':'卤','燒':'烧','煲':'煲','湯':'汤','飯':'饭','麵':'面','餅':'饼','粥':'粥','蛋':'蛋','菜':'菜','醬':'酱','糖':'糖','鹽':'盐','點':'点','條':'条','塊':'块','份':'份','碟':'碟','個':'个','隻':'只','煎':'煎','炒':'炒','蒸':'蒸','燜':'焖','燉':'炖','烤':'烤','炸':'炸','焗':'焗','凍':'冻','熱':'热','鮮':'鲜','嫩':'嫩','脆':'脆','軟':'软','濃':'浓','淡':'淡','辣':'辣','甜':'甜','酸':'酸','鹹':'咸','廣':'广','東':'东','風':'风','記':'记','號':'号','閣':'阁','園':'园','館':'馆','樓':'楼','優':'优','選':'选','經':'经','標':'标','準':'准','與':'与','開':'开','關':'关','電':'电','話':'话','網':'网','車':'车','門':'门','書':'书','學':'学','師':'师','員':'员','長':'长','華':'华','國':'国','區':'区','場':'场','種':'种','類':'类','質':'质','體':'体','節':'节','張':'张','動':'动','機':'机','對':'对','裡':'里','後':'后','從':'从','過':'过','間':'间','樣':'样','見':'见','頭':'头','實':'实','結':'结','當':'当','處':'处','總':'总','進':'进','現':'现','發':'发','線':'线','連':'连','運':'运','達':'达','傳':'传','輕':'轻','邊':'边','產':'产','話':'话','識':'识','認':'认','議':'议','論':'论','訂':'订','計':'计','調':'调','設':'设','許':'许','試':'试','語':'语','讀':'读','護':'护','變':'变','讓':'让','買':'买','賣':'卖','費':'费','賞':'赏','資':'资','貨':'货','貿':'贸','財':'财','價':'价','貴':'贵','賓':'宾','貢':'贡','響':'响','頁':'页','順':'顺','領':'领','題':'题','顏':'颜','額':'额','飲':'饮','餐':'餐','養':'养','駕':'驾','騎':'骑','驗':'验','髮':'发','鬥':'斗','鑊':'镬','鍋':'锅','鐵':'铁','鏡':'镜','鋪':'铺','鮑':'鲍','鱸':'鲈','鯇':'鲩','龍':'龙','龜':'龟'};
const _ARAB_TO_CN = {'0':'零','1':'一','2':'二','3':'三','4':'四','5':'五','6':'六','7':'七','8':'八','9':'九'};

export function normalizeProductName(raw) {
    let s = String(raw || '').trim();
    if (!s) return '';
    // Strip bracketed marketing text: 【...】 （...） (...) [...] etc.
    s = s.replace(/【[^】]*】/g, '').replace(/\([^)]*\)/g, '').replace(/（[^）]*）/g, '').replace(/\[[^\]]*\]/g, '');
    // Traditional → Simplified
    s = s.split('').map(c => _TRAD_TO_SIMP[c] || c).join('');
    // Arabic digits → Chinese digits (single-char only, for product names like "9秒"→"九秒")
    s = s.split('').map(c => _ARAB_TO_CN[c] || c).join('');
    // Remove extra whitespace
    s = s.replace(/\s+/g, '').trim();
    return s;
}

export function resolveForecastProductName(rawName, aliasLookup) {
    const original = String(rawName || '').trim();
    const normalized = normalizeProductName(original);
    if (!normalized) return { key: '', display: '' };
    if (aliasLookup && aliasLookup.has(normalized)) {
      const hit = aliasLookup.get(normalized);
      return {
        key: String(hit?.canonicalNorm || normalized),
        display: String(hit?.canonical || original || normalized).trim()
      };
    }
    return { key: normalized, display: original || normalized };
}

export function forecastDayTypeLabel(date, isHoliday) {
    if (isHoliday === true) return 'holiday';
    const d = new Date(String(date || '') + 'T00:00:00');
    if (Number.isFinite(d.getTime())) {
      const day = d.getDay();
      if (day === 0 || day === 6) return 'holiday';
    }
    return 'workday';
}

export function normalizeForecastWeatherTag(input) {
    const s = String(input || '').trim();
    if (!s) return '';
    if (/雨|暴雨|雷|阵雨/.test(s)) return 'rain';
    if (/雪/.test(s)) return 'snow';
    if (/雾|霾/.test(s)) return 'fog';
    if (/风/.test(s)) return 'wind';
    if (/阴|多云/.test(s)) return 'cloudy';
    if (/晴/.test(s)) return 'sunny';
    return s.toLowerCase();
}

export function createProductAliasHelpers({ normalizeBrandId, resolveStoreBrandContext, isExcludedForecastProduct }) {
  function buildForecastProductAliasLookup(state0, scopeInput) {
    const scopeStore = typeof scopeInput === 'string' ? String(scopeInput || '').trim() : String(scopeInput?.store || '').trim();
    const scopeBrandId = normalizeBrandId(typeof scopeInput === 'string' ? '' : scopeInput?.brandId);
    const inferredBrandId = scopeBrandId || normalizeBrandId(resolveStoreBrandContext(state0, scopeStore).brandId);
    const lookup = new Map();
    const list = Array.isArray(state0?.forecastProductAliasRules) ? state0.forecastProductAliasRules : [];
    list
      .filter((x) => {
        const ruleBrandId = normalizeBrandId(x?.brandId);
        if (ruleBrandId && inferredBrandId) return ruleBrandId === inferredBrandId;
        if (inferredBrandId && !ruleBrandId) {
          const rowBrandId = normalizeBrandId(resolveStoreBrandContext(state0, String(x?.store || '').trim()).brandId);
          return rowBrandId === inferredBrandId;
        }
        return String(x?.store || '').trim() === scopeStore;
      })
      .forEach((rule) => {
        const canonical = String(rule?.canonical || '').trim();
        const canonicalNorm = normalizeProductName(canonical);
        if (!canonical || !canonicalNorm) return;
        const aliases = Array.isArray(rule?.aliases) ? rule.aliases : [];
        [canonical, ...aliases].forEach((name) => {
          const norm = normalizeProductName(name);
          if (!norm) return;
          lookup.set(norm, { canonical, canonicalNorm });
        });
      });
    return lookup;
  }

  function canonicalizeForecastProductQuantities(input, aliasLookup) {
    const source = input && typeof input === 'object' ? input : {};
    const out = {};
    Object.entries(source).forEach(([product, qtyRaw]) => {
      const qty = Number(qtyRaw || 0);
      if (!Number.isFinite(qty) || qty <= 0) return;
      const resolved = resolveForecastProductName(product, aliasLookup);
      if (!resolved.key || isExcludedForecastProduct(resolved.display)) return;
      out[resolved.display] = Number((Number(out[resolved.display] || 0) + qty).toFixed(2));
    });
    return out;
  }

  function canonicalizeForecastRows(rows, aliasLookup) {
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      ...row,
      productQuantities: canonicalizeForecastProductQuantities(row?.productQuantities, aliasLookup)
    }));
  }

  return {
    buildForecastProductAliasLookup,
    canonicalizeForecastProductQuantities,
    canonicalizeForecastRows,
  };
}

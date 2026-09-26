// منطق لعبة «بَديهة» — نُقل كما هو من الملف الأصلي دون تعديل في السلوك.
// أوضاع اللعب، بناء الجولة مع أولوية الأسئلة غير المُلعبة، تحقق أسماء الفرق،
// وتسلسل الجلسة (حفظ/استئناف). خالٍ من React ليُختبر بمعزل.
export const BANK_CONTENT_VERSION = 'badeeha-text-challenge-2026-09-25';

// Retired identifiers may remain in a player's history. They must neither mark
// new cards as played nor inflate the progress shown for the current bank.
export function currentQuestionHistoryCount(categories, history) {
  return (categories || []).reduce((total, category) => total + category.qs.filter((q) => Boolean(history?.[q.qid])).length, 0);
}

const MaydanLogicBeta = (() => {
    const MODES = Object.freeze({
        family: Object.freeze({
          id: "family",
          label: "عائلي",
          description: "من 200 إلى 600 — مناسب للجميع",
          tiers: Object.freeze([200, 400, 600]),
          icon: "👨‍👩‍👧‍👦",
        }),
        standard: Object.freeze({
          id: "standard",
          label: "تحدّي",
          description: "يصل إلى 800 — أسئلة صعبة جدًا",
          tiers: Object.freeze([200, 400, 600, 800]),
          icon: "🔥",
        }),
        expert: Object.freeze({
          id: "expert",
          label: "خبراء",
          description: "يصل إلى 1000 — المستوى المستحيل",
          tiers: Object.freeze([200, 400, 600, 800, 1e3]),
          icon: "🧠",
        }),
      }),
      ROUND_SIZES = Object.freeze([20, 30, 60]);
    function shuffled(input, random = Math.random) {
      const result = [...input];
      for (let index = result.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(random() * (index + 1));
        [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
      }
      return result;
    }
    function questionId(categoryId, question, fallbackIndex = 0) {
      return question.qid || `${categoryId}-legacy-${fallbackIndex}`;
    }
    function historyTime(history, qid) {
      const value = history && history[qid];
      return value ? (typeof value == "number" ? value : 1) : 0;
    }
    function prioritizedQuestions(category, tier, history, random) {
      return category.qs
        .map((question, index) => ({
          ...question,
          qid: questionId(category.id, question, index),
          __history: historyTime(history, questionId(category.id, question, index)),
          __random: random(),
        }))
        .filter((question) => question.p === tier)
        .sort((left, right) => {
          const leftPlayed = left.__history > 0 ? 1 : 0,
            rightPlayed = right.__history > 0 ? 1 : 0;
          return (
            leftPlayed - rightPlayed ||
            left.__history - right.__history ||
            left.__random - right.__random
          );
        })
        .map(({ __history, __random, ...question }) => question);
    }
    function buildDeck2(
      categories,
      categoryIds,
      history,
      tiers,
      requestedTotal,
      random = Math.random,
    ) {
      if (!Array.isArray(categoryIds) || categoryIds.length !== 6)
        throw new Error("يجب اختيار ست فئات بالضبط");
      if (!ROUND_SIZES.includes(requestedTotal)) throw new Error("حجم الجولة غير مدعوم");
      const selected = categoryIds.map((id) => categories.find((category) => category.id === id));
      if (selected.some((category) => !category)) throw new Error("إحدى الفئات غير موجودة");
      if (!Array.isArray(tiers) || tiers.length === 0) throw new Error("وضع اللعب غير صالح");
      const baseCount = Math.floor(requestedTotal / selected.length),
        remainder = requestedTotal % selected.length,
        deck = {};
      if (
        (selected.forEach((category, categoryIndex) => {
          const target = baseCount + (categoryIndex < remainder ? 1 : 0),
            pools = new Map(
              tiers.map((tier) => [
                tier,
                prioritizedQuestions(category, tier, history || {}, random),
              ]),
            ),
            cursors = new Map(tiers.map((tier) => [tier, 0])),
            questions = [];
          let cycle = 0;
          for (; questions.length < target;) {
            let addedThisCycle = 0;
            for (let offset = 0; offset < tiers.length && questions.length < target; offset += 1) {
              const tier = tiers[(categoryIndex + cycle + offset) % tiers.length],
                pool = pools.get(tier) || [],
                cursor = cursors.get(tier) || 0;
              cursor < pool.length &&
                (questions.push(pool[cursor]),
                cursors.set(tier, cursor + 1),
                (addedThisCycle += 1));
            }
            if (addedThisCycle === 0) break;
            cycle += 1;
          }
          if (questions.length !== target)
            throw new Error(`لا تكفي أسئلة الفئة «${category.name}» لهذا الوضع`);
          deck[category.id] = questions;
        }),
        Object.values(deck).reduce((sum, questions) => sum + questions.length, 0) !==
          requestedTotal)
      )
        throw new Error("تعذر بناء الجولة بالحجم المطلوب");
      return deck;
    }
    function normalizeTeamName(value) {
      return String(value || "")
        .trim()
        .replace(/\s+/g, " ")
        .toLocaleLowerCase("ar");
    }
    function validateTeamNames(names) {
      const trimmed = names.map((name) =>
        String(name || "")
          .trim()
          .replace(/\s+/g, " "),
      );
      if (trimmed.some((name) => !name)) return { ok: !1, message: "اكتب اسمًا لكل فريق" };
      const normalized = trimmed.map(normalizeTeamName);
      return new Set(normalized).size !== normalized.length
        ? { ok: !1, message: "يجب أن يكون لكل فريق اسم مختلف" }
        : { ok: !0, names: trimmed };
    }
    function deckToIds(deck) {
      return Object.fromEntries(
        Object.entries(deck || {}).map(([categoryId, questions]) => [
          categoryId,
          questions.map((question, index) => questionId(categoryId, question, index)),
        ]),
      );
    }
    function idsToDeck(categories, serializedDeck) {
      const restored = {};
      for (const [categoryId, ids] of Object.entries(serializedDeck || {})) {
        const category = categories.find((item) => item.id === categoryId);
        if (!category || !Array.isArray(ids)) return null;
        const lookup = new Map(
            category.qs.map((question, index) => [
              questionId(categoryId, question, index),
              { ...question, qid: questionId(categoryId, question, index) },
            ]),
          ),
          questions = ids.map((qid) => lookup.get(qid));
        if (questions.some((question) => !question)) return null;
        restored[categoryId] = questions;
      }
      return restored;
    }
    const TOOL_IDS = ["double", "two", "time"],
      TIMER_LENGTHS = [30, 60, 90],
      isCount = (value) => Number.isSafeInteger(value) && value >= 0,
      isTeam = (team) =>
        !!team &&
        typeof team == "object" &&
        typeof team.name == "string" &&
        isCount(team.score) &&
        isCount(team.correct) &&
        isCount(team.steals) &&
        !!team.tools &&
        typeof team.tools == "object" &&
        TOOL_IDS.every((id) => typeof team.tools[id] == "boolean"),
      isTeams = (teams) => Array.isArray(teams) && teams.length >= 2 && teams.length <= 4 && teams.every(isTeam);
    // لقطة تالفة (يد عابثة، نسخة أقدم، تخزين مبتور) كانت تمرّ بفحص سطحي ثم تُسقط شاشة السؤال
    // عند الاستئناف؛ كل حقل تقرأه الواجهة يُفحص هنا كما تفحص فبركة لقطتها.
    function isValidSession(categories, session) {
      if (
        !session ||
        typeof session != "object" ||
        session.version !== 2 ||
        session.contentVersion !== BANK_CONTENT_VERSION ||
        !isTeams(session.teams) ||
        !Array.isArray(session.selectedCategories) ||
        session.selectedCategories.length !== 6 ||
        session.selectedCategories.some((id) => typeof id != "string") ||
        !MODES[session.mode] ||
        !ROUND_SIZES.includes(session.roundSize)
      )
        return !1;
      const restored = idsToDeck(categories, session.deck);
      if (
        !restored ||
        Object.values(restored).reduce((sum, questions) => sum + questions.length, 0) !== session.roundSize ||
        Object.keys(restored).some((id) => !session.selectedCategories.includes(id))
      )
        return !1;
      const qids = new Set(Object.values(restored).flat().map((question) => question.qid));
      if (session.turn !== undefined && !(Number.isInteger(session.turn) && session.turn >= 0 && session.turn < session.teams.length)) return !1;
      if (session.used !== undefined) {
        if (!session.used || typeof session.used != "object" || Array.isArray(session.used)) return !1;
        if (Object.keys(session.used).some((qid) => !qids.has(qid))) return !1;
      }
      if (session.current !== undefined && session.current !== null) {
        const { categoryId, index } = session.current;
        if (!restored[categoryId] || !Number.isInteger(index) || index < 0 || index >= restored[categoryId].length) return !1;
      }
      if (session.screen !== undefined && !["board", "question"].includes(session.screen)) return !1;
      if (session.screen === "question" && !session.current) return !1;
      if (session.timerLength !== undefined && !TIMER_LENGTHS.includes(session.timerLength)) return !1;
      if (session.timeLeft !== undefined && !(Number.isFinite(session.timeLeft) && session.timeLeft >= 0 && session.timeLeft <= 600)) return !1;
      if (session.hintsUsed !== undefined && !isCount(session.hintsUsed)) return !1;
      if (session.mixedItems !== undefined && !(Array.isArray(session.mixedItems) && session.mixedItems.every((item) => typeof item == "string"))) return !1;
      if (session.effect !== undefined && (!session.effect || typeof session.effect != "object")) return !1;
      if (session.questionBaseTeams !== undefined && session.questionBaseTeams !== null && !isTeams(session.questionBaseTeams)) return !1;
      return !0;
    }
    return {
      MODES,
      ROUND_SIZES,
      shuffled,
      questionId,
      buildDeck: buildDeck2,
      normalizeTeamName,
      validateTeamNames,
      deckToIds,
      idsToDeck,
      isValidSession,
    };
  })();

// ── دوال خالصة يشاركها App.js، مجموعة هنا كي تُختبر في Node بلا React ──────

// كل تلميح يُطلب يخصم من نقاط السؤال، ولا تقل أبدًا عن الربع.
export const HINT_COST_PERCENT = 25;

// أنواع الأسئلة التي تحتاج ملف وسائط؛ تُشتق منها مجموعة الفئة في شاشة الإعداد.
export const MEDIA_QUESTION_TYPES = Object.freeze(["image", "audio", "diff", "video"]);
const MEDIA_TYPE_SET = new Set(MEDIA_QUESTION_TYPES),
  CATEGORY_GROUP_CACHE = new WeakMap();

// «وسائط» لحزمة فيها صور/أصوات، «خاصة» لحزم الألغاز (إيموجي، شفرة، تلميحات…)،
// و«معلومات» لما تبقّى: أسئلة نصية بحتة. كل هذه المفاتيح موجودة فعلًا في البنك،
// بخلاف category.special و category.pack اللتين لم تكونا على أي حزمة.
export function categoryGroup(category) {
  if (!category || !Array.isArray(category.qs)) return "info";
  const cached = CATEGORY_GROUP_CACHE.get(category);
  if (cached) return cached;
  let media = !1,
    special = !1;
  for (const question of category.qs) {
    const type = question && question.type;
    if (!type || type === "plain") continue;
    if (MEDIA_TYPE_SET.has(type)) media = !0;
    else special = !0;
  }
  const group = media ? "media" : special ? "special" : "info";
  return (CATEGORY_GROUP_CACHE.set(category, group), group);
}

export function filterCategories(categories, { filter = "all", search = "", favorites = [] } = {}) {
  const term = String(search || "").trim();
  return (categories || []).filter((category) => {
    if (term && !String(category.name || "").includes(term)) return !1;
    if (filter === "favorites") return favorites.includes(category.id);
    if (filter === "all") return !0;
    return categoryGroup(category) === filter;
  });
}

// النقاط التي ستُمنح فعلًا بعد التلميحات — يستعملها الحَكم وترويسة السؤال معًا
// كي لا تَعِد الترويسة بألف ثم يُمنح خمسمئة.
export function pointsAfterHints(points, hintsUsed, costPercent = HINT_COST_PERCENT) {
  const used = Math.max(0, Math.floor(Number(hintsUsed) || 0));
  if (!used) return points;
  return Math.max(Math.round(points * 0.25), Math.round((points * (100 - used * costPercent)) / 100));
}

// أعلى شريحة في وضع اللعب — «حتى 1000» كانت تُطبع لوضع «تحدّي» الذي يقف عند 800.
export function modeTopTier(mode) {
  const tiers = (mode && mode.tiers) || [];
  return tiers.length ? tiers[tiers.length - 1] : 0;
}

export default MaydanLogicBeta;

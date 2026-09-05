// منطق لعبة «بَديهة» — نُقل كما هو من الملف الأصلي دون تعديل في السلوك.
// أوضاع اللعب، بناء الجولة مع أولوية الأسئلة غير المُلعبة، تحقق أسماء الفرق،
// وتسلسل الجلسة (حفظ/استئناف). خالٍ من React ليُختبر بمعزل.
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
    function isValidSession(categories, session) {
      if (
        !session ||
        session.version !== 2 ||
        !Array.isArray(session.teams) ||
        session.teams.length < 2 ||
        session.teams.length > 4 ||
        !Array.isArray(session.selectedCategories) ||
        session.selectedCategories.length !== 6 ||
        !MODES[session.mode] ||
        !ROUND_SIZES.includes(session.roundSize)
      )
        return !1;
      const restored = idsToDeck(categories, session.deck);
      return restored
        ? Object.values(restored).reduce((sum, questions) => sum + questions.length, 0) ===
            session.roundSize
        : !1;
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

export default MaydanLogicBeta;

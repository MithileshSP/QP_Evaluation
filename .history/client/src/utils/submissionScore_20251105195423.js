export function resolveSubmissionScore(submission) {
  if (!submission || typeof submission !== "object") {
    return { score: 0, maxScore: 0 };
  }

  const fallbackScore = Number(submission.score ?? 0);
  const fallbackMax = Number(submission.maxScore ?? 0);

  const breakdown = Array.isArray(submission.breakdown)
    ? submission.breakdown
    : [];

  if (breakdown.length === 0) {
    return {
      score: Number.isFinite(fallbackScore) ? fallbackScore : 0,
      maxScore: Number.isFinite(fallbackMax) ? fallbackMax : 0,
    };
  }

  let sumScore = 0;
  let sumMax = 0;

  breakdown.forEach((item) => {
    const itemScore = Number(item?.score ?? 0);
    const itemMax = Number(item?.maxScore ?? 0);
    if (Number.isFinite(itemScore)) {
      sumScore += itemScore;
    }
    if (Number.isFinite(itemMax)) {
      sumMax += itemMax;
    }
  });

  const tolerance = 0.01;
  const normalizedScore = Number.isFinite(sumScore) ? sumScore : fallbackScore;
  const normalizedMax = Number.isFinite(sumMax) ? sumMax : fallbackMax;

  const resolvedScore =
    Number.isFinite(fallbackScore) &&
    Math.abs(fallbackScore - normalizedScore) <= tolerance
      ? fallbackScore
      : normalizedScore;

  let resolvedMax = normalizedMax;

  if (Number.isFinite(fallbackMax) && fallbackMax > 0) {
    if (!Number.isFinite(normalizedMax) || normalizedMax <= 0) {
      resolvedMax = fallbackMax;
    } else if (Math.abs(fallbackMax - normalizedMax) <= tolerance) {
      resolvedMax = fallbackMax;
    } else if (fallbackMax > normalizedMax) {
      resolvedMax = fallbackMax;
    }
  }

  return {
    score: Number.isFinite(resolvedScore) ? resolvedScore : 0,
    maxScore:
      Number.isFinite(resolvedMax) && resolvedMax > 0
        ? resolvedMax
        : fallbackMax,
  };
}

export function formatScore(value) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return "0";
  }
  if (Number.isInteger(numeric)) {
    return numeric.toString();
  }
  return numeric.toFixed(1);
}

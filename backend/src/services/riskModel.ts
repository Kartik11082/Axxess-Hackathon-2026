import {
  ActivityLevel,
  LifeStage,
  OnboardingResponses,
  PredictedDisease,
  PredictionLog,
  PredictionResponse,
  StreamingVitals
} from "../models/types";

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function avg(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalize(value: number, base: number): number {
  if (base === 0) {
    return 0;
  }
  return clamp(value / base);
}

function determineMomentum(currentRisk: number, previousRisk?: number): "Increasing" | "Improving" | "Stable" {
  if (previousRisk === undefined) {
    return "Stable";
  }
  const delta = currentRisk - previousRisk;
  if (delta > 0.05) {
    return "Increasing";
  }
  if (delta < -0.05) {
    return "Improving";
  }
  return "Stable";
}

export function mapDiseaseToIcd(disease: PredictedDisease): string {
  if (disease === "Diabetes") {
    return "E11.9";
  }
  if (disease === "Cardiac") {
    return "I25.x";
  }
  return "Z03.89";
}

function normalizedWeightedScore(items: Array<{ value: number; weight: number }>): number {
  const weightedSum = items.reduce((sum, item) => sum + item.value * item.weight, 0);
  const maxPossible = items.reduce((sum, item) => sum + 4 * item.weight, 0);
  return maxPossible === 0 ? 0 : clamp(weightedSum / maxPossible);
}

function activityRisk(activityLevel: ActivityLevel): number {
  if (activityLevel === "Low") {
    return 4;
  }
  if (activityLevel === "Moderate") {
    return 2;
  }
  return 1;
}

function lifeStageRisk(lifeStage: LifeStage): number {
  if (lifeStage === "Senior") {
    return 4;
  }
  if (lifeStage === "Mid-life") {
    return 2;
  }
  return 1;
}

export function calculateOnboardingRisk(responses: OnboardingResponses): {
  riskScore: number;
  predictedDisease: PredictedDisease;
} {
  const assessment = calculateInitialRiskAssessment({
    responses,
    activityLevel: "Moderate",
    lifeStage: "Mid-life"
  });

  return {
    riskScore: assessment.baselineRiskScore,
    predictedDisease: assessment.probableDisease
  };
}

export function calculateInitialRiskAssessment(params: {
  responses: OnboardingResponses;
  activityLevel: ActivityLevel;
  lifeStage: LifeStage;
}): {
  baselineRiskScore: number;
  probableDisease: PredictedDisease;
  confidenceLabel: "Low";
  diabetesScore: number;
  cardiacScore: number;
} {
  const { responses, activityLevel, lifeStage } = params;

  const stageRisk = lifeStageRisk(lifeStage);
  const inferredActivityRisk = activityRisk(activityLevel);

  const diabetesScore = normalizedWeightedScore([
    { value: responses.unusualThirst, weight: 3 },
    { value: responses.wakeUpAtNight, weight: 3 },
    { value: responses.fatigueAfterMeals, weight: 2 },
    { value: stageRisk, weight: 1.5 }
  ]);

  const cardiacWeights =
    activityLevel === "High"
      ? [
          { value: responses.breathlessDuringLightActivity, weight: 2.2 },
          { value: inferredActivityRisk, weight: 1.2 },
          { value: stageRisk, weight: 2.4 }
        ]
      : [
          { value: responses.breathlessDuringLightActivity, weight: 3 },
          { value: inferredActivityRisk, weight: 2 },
          { value: responses.monitorHeartRateRegularly, weight: 2.2 },
          { value: stageRisk, weight: 2.4 }
        ];

  const cardiacScore = normalizedWeightedScore(cardiacWeights);

  const baselineRiskScore = Number(Math.max(diabetesScore, cardiacScore).toFixed(2));
  let probableDisease: PredictedDisease = "Stable";
  if (baselineRiskScore >= 0.35) {
    probableDisease = cardiacScore >= diabetesScore ? "Cardiac" : "Diabetes";
  }

  return {
    baselineRiskScore,
    probableDisease,
    confidenceLabel: "Low",
    diabetesScore: Number(diabetesScore.toFixed(2)),
    cardiacScore: Number(cardiacScore.toFixed(2))
  };
}

export function runPredictionModel(params: {
  patientId: string;
  vitals: StreamingVitals[];
  previousPrediction?: PredictionLog;
}): PredictionResponse {
  const { patientId, vitals, previousPrediction } = params;

  const heartRates = vitals.map((item) => item.heartRate);
  const stepCounts = vitals.map((item) => item.stepCount);
  const oxygenLevels = vitals.map((item) => item.bloodOxygen);
  const sleepScores = vitals.map((item) => item.sleepScore);

  const avgHr = avg(heartRates);
  const avgSteps = avg(stepCounts);
  const avgSpO2 = avg(oxygenLevels);
  const avgSleep = avg(sleepScores);

  const hrTrend = heartRates.length > 2 ? heartRates[heartRates.length - 1] - heartRates[0] : 0;

  const elevatedHr = normalize(avgHr - 75, 45);
  const lowActivity = normalize(5000 - avgSteps, 5000);
  const poorSleep = normalize(78 - avgSleep, 78);
  const lowOxygen = normalize(97 - avgSpO2, 8);
  const risingHrTrend = normalize(hrTrend, 25);

  const cardiacScore = clamp(
    elevatedHr * 0.33 +
      lowActivity * 0.2 +
      poorSleep * 0.2 +
      lowOxygen * 0.17 +
      risingHrTrend * 0.1
  );

  const diabetesScore = clamp(
    elevatedHr * 0.37 +
      poorSleep * 0.23 +
      lowActivity * 0.23 +
      normalize(hrTrend, 18) * 0.1 +
      normalize(96 - avgSpO2, 8) * 0.07
  );

  const predictedRiskScore = Number(Math.max(cardiacScore, diabetesScore).toFixed(2));
  const diseaseSignalGap = Math.abs(cardiacScore - diabetesScore);

  let predictedDisease: PredictedDisease = "Stable";
  if (predictedRiskScore > 0.35) {
    predictedDisease = cardiacScore >= diabetesScore ? "Cardiac" : "Diabetes";
  }

  const sampleConfidence = clamp(vitals.length / 12);
  const confidence = Number(clamp(0.55 + sampleConfidence * 0.25 + diseaseSignalGap * 0.2).toFixed(2));

  const riskMomentum = determineMomentum(predictedRiskScore, previousPrediction?.predictedRiskScore);
  const trendSlope = riskMomentum === "Increasing" ? 0.03 : riskMomentum === "Improving" ? -0.025 : 0.005;

  const predictedTrend = Array.from({ length: 7 }, (_, index) => {
    const projected = clamp(predictedRiskScore + trendSlope * (index + 1));
    return {
      dayOffset: index + 1,
      label: `Day ${index + 1}`,
      score: Number(projected.toFixed(2))
    };
  });

  const explainability: string[] = [];
  if (elevatedHr > 0.45) {
    explainability.push("Elevated resting HR");
  }
  if (poorSleep > 0.4) {
    explainability.push("Poor sleep trend");
  }
  if (lowActivity > 0.4) {
    explainability.push("Reduced activity");
  }
  if (lowOxygen > 0.35) {
    explainability.push("Lower blood oxygen pattern");
  }
  if (explainability.length === 0) {
    explainability.push("No dominant instability feature detected");
  }

  return {
    patientId,
    predictedRiskScore,
    predictedDisease,
    confidence,
    forecastWindow: "Next 7 days",
    predictedTrend,
    riskMomentum,
    explainability: explainability.slice(0, 3),
    icdCode: mapDiseaseToIcd(predictedDisease)
  };
}

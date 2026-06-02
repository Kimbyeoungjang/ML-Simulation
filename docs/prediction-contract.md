# Prediction Contract

Prediction contract는 TileForge report와 artifact에서 각 숫자가 무엇을 의미하는지 정하는 문서입니다. production report에서 가장 중요한 원칙은 **서로 다른 target을 같은 수치처럼 비교하지 않는 것**입니다.

## 대표 수치 계약

| 이름 | 의미 | 비교 대상 | 주 사용처 |
|---|---|---|---|
| `fullLayerCycles` | 전체 layer/topology cycle estimate | SCALE-Sim full topology cycle | 하드웨어 설계, 외부 검증 |
| `tilePolicyCycles` | 특정 tile 후보 ranking cost | top-k tile micro-run 또는 tile 후보끼리 | tile 선택, lowering hint |
| `cycles` | UI 대표값 | context에 따라 full-layer 또는 corrected value | summary table |
| `totalCycles` | workload 전체 full-layer 대표 cycle 합 | SCALE-Sim total cycle, 가능한 경우 | 전체 성능 비교 |
| `utilization` | 유효 MAC / array capacity | 후보끼리 비교 | PE 활용률 분석 |
| `paddingRatio` | padded MAC 낭비 비율 | 후보끼리 비교 | tile 경계 손실 분석 |
| `tileScratchBytes` | tile 하나의 scratch footprint | SRAM budget | tile fit 판단 |
| `fullLayerSramBytes` | 전체 layer working set 진단 | SRAM budget/traffic | 메모리 병목 분석 |
| `fullLayerDramBytes` | DRAM traffic estimate | SCALE-Sim memory report, 가능한 경우 | roofline/memory 분석 |
| `predictionConfidence` | 학습 domain과 안정성 기반 confidence | 0~1 | design-space penalty/warning |

## 금지되는 비교

다음 비교는 report에서 피해야 합니다.

- tile-policy cycle vs SCALE-Sim full topology cycle
- SRAM bytes vs cycle
- IREE compile 성공 여부 vs runtime 성능
- low sample Estimator Suite correction vs 검증된 실측값
- 다른 workload scale의 total cycle 직접 비교

## 권장 비교

| 질문 | 봐야 할 값 |
|---|---|
| 이 hardware가 더 빠른가? | full-layer cycle, normalized throughput, SCALE-Sim validation |
| 이 tile이 더 좋은가? | tile-policy cycle, utilization, padding, tileScratchBytes |
| memory-bound인가? | roofline, fullLayerDramBytes, arithmetic intensity |
| SRAM이 부족한가? | tileScratchBytes, fullLayerSramBytes, overflow warning |
| learned correction을 믿어도 되는가? | readiness level, validation error, predictionConfidence |

## Report 작성 규칙

1. 하드웨어 성능 결론은 full-layer 수치로 씁니다.
2. tile 선택 결론은 tile-policy 수치로 씁니다.
3. 외부 도구가 skipped면 “검증 안 됨”을 명시합니다.
4. Estimator Suite가 active이면 model scope와 readiness를 함께 표시합니다.
5. confidence가 낮은 후보는 “추천”이 아니라 “검증 필요 후보”로 표현합니다.

## Artifact contract

`prediction_contract.json`은 job artifact 안에 저장됩니다. 이 파일은 자동 검증/보고서 생성기가 각 metric을 어떤 의미로 해석해야 하는지 알려줍니다.

포함 항목:

- target scope
- cycle field semantics
- memory field semantics
- external validation mapping
- model correction 적용 여부
- confidence/warning policy

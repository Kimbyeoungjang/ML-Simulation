# Estimator Model

TileForge estimator는 많은 후보를 빠르게 ranking하기 위한 analytical model입니다. 실제 silicon timing을 대체하지 않고, SCALE-Sim/IREE/실측으로 검증할 후보를 줄이는 것이 목적입니다.

## 두 개의 prediction target

TileForge는 production 기준으로 cycle target을 명확히 분리합니다.

| Target | 의미 | 사용처 |
|---|---|---|
| `full-layer` | 전체 GEMM/layer topology를 한 번 실행할 때의 hardware-design cycle | SCALE-Sim full topology validation, hardware design report, design-space graph |
| `tile-policy` | 특정 tileM/tileN/tileK 후보의 ranking용 cost | tile 선택, top-k 후보, MLIR/lowering hint |

두 target은 같은 숫자가 아닐 수 있습니다. tile micro-run을 tile count로 확장한 값은 pipeline fill/drain, reuse, boundary effect 때문에 full topology SCALE-Sim 결과와 다를 수 있습니다.

## 입력 feature

- `M/N/K`
- array rows/cols
- dataflow WS/OS/IS
- tileM/tileN/tileK
- dtype bytes
- SRAM capacity
- memory bandwidth
- padded dimensions
- edge tile count
- active PE count
- operand footprint
- estimated SRAM/DRAM access

## 주요 metric

| Metric | 의미 |
|---|---|
| `cycles` | UI 대표값. 목적에 따라 full-layer 또는 corrected value가 들어갑니다. |
| `tilePolicyCycles` | tile ranking용 cycle/cost |
| `fullLayerCycles` | hardware-design용 full-layer cycle |
| `utilization` | 유효 MAC이 array capacity를 채우는 정도 |
| `paddingRatio` | tile 경계 때문에 낭비되는 padded MAC 비율 |
| `sramBytes` | 호환성 필드. production report에서는 tile scratch/layer footprint를 분리해 표시합니다. |
| `tileScratchBytes` | tile 하나를 계산할 때 필요한 scratch footprint |
| `fullLayerSramBytes` | full-layer working set 진단값 |
| `fullLayerDramBytes` | full-layer DRAM traffic 진단값 |
| `predictionConfidence` | Estimator Suite domain guard 기반 confidence |

## Full-layer baseline

WS GEMM의 full-layer baseline은 array와 전체 topology를 직접 놓고 계산하는 형태입니다.

```text
fullLayerCycles ≈ ceil(K / arrayRows)
                × ceil(N / arrayCols)
                × (M + 2 × arrayRows + arrayCols - 3)
```

이 식은 전체 layer가 systolic array를 통과할 때의 fill/steady/drain 구조를 반영하기 위한 baseline입니다. OS/IS는 dataflow factor와 memory/stall 진단을 통해 보정됩니다.

## Tile-policy ranking

tile-policy ranking은 다음 항목을 함께 봅니다.

```text
score = cycle term
      + utilization penalty
      + padding penalty
      + SRAM overflow penalty
      + boundary penalty
      + objective-specific weights
```

objective별 의도:

| Objective | 의도 |
|---|---|
| `balanced` | cycle/utilization/padding/SRAM을 균형 있게 반영 |
| `cycles` | cycle 최소화 중심 |
| `utilization` | PE 활용률 중심 |
| `hardware-design` | 하드웨어 비교에 적합하도록 full-layer cycle과 안정성 중심 |
| `pareto` | 하나의 지표만 좋은 후보도 넓게 남김 |

## Memory model

TileForge는 다음을 분리해 계산합니다.

- tile scratch SRAM
- full-layer SRAM footprint
- ifmap/filter/ofmap access
- DRAM bytes
- operational intensity
- SRAM overflow ratio

이 값들은 cycle과 같은 단위가 아니므로, report에서는 cycle과 memory traffic을 분리해서 설명합니다.

## Roofline model

Roofline은 다음 관계를 봅니다.

```text
ops = 2 × M × N × K
arithmeticIntensity = ops / dramBytes
achievedGops = ops / seconds / 1e9
computeRoofGops = peakMacs × frequency
memoryRoofGops = arithmeticIntensity × memoryBandwidth
```

`achievedGops`가 memory roof에 가까우면 memory-bound, compute roof에 가까우면 compute-bound로 해석합니다.

## Energy model

Energy estimate는 단위 에너지 parameter를 기반으로 합니다.

```text
totalEnergy = MAC energy + SRAM access energy + DRAM byte energy + static energy
EDP = energy × executionTime
```

공정/전압/실제 SRAM macro가 확정되지 않았으므로 상대 비교와 병목 설명용으로 사용합니다.

## Estimator Suite correction

Estimator Suite가 active이면 analytical output에 correction layer를 적용합니다.

- full-layer model은 full-layer cycle에만 적용합니다.
- tile-policy model은 tile ranking에만 적용합니다.
- training domain 밖 후보는 confidence를 낮추고 design-space recommendation을 보수적으로 조정합니다.
- mixed/legacy model은 full-layer 값을 덮어쓰지 않습니다.

## 해석 원칙

1. 발표/보고서의 하드웨어 성능 비교는 full-layer cycle을 기준으로 합니다.
2. tileM/tileN/tileK 선택 이유는 tile-policy cycle과 utilization/padding/SRAM으로 설명합니다.
3. SCALE-Sim과 비교할 때는 full-layer-to-full-layer인지 먼저 확인합니다.
4. Estimator Suite 결과는 readiness gate와 validation error를 함께 제시합니다.
5. 최종 수치 주장은 외부 검증 artifact가 있을 때만 강하게 표현합니다.

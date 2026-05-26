# v20 IREE runtime evidence hardening

TileForge의 IREE 경로는 의도적으로 `compile 가능성`과 `runtime 성능 근거`를 분리한다. 이전 단계에서는 `iree_benchmark_plan.md`가 baseline/hinted 실험을 안내했지만, benchmark 로그를 구조적으로 해석하는 단계가 약했다.

이번 변경은 `npm run benchmark:iree`가 다음 파일을 생성하도록 강화한다.

- `iree-runtime/iree_runtime_benchmark_report.md/json`
- `iree-runtime/iree_runtime_decision.md/json`

## Runtime parsing

`src/lib/ireeRuntimeEvidence.ts`는 Google Benchmark 형식의 `real_time` 행을 파싱한다.

- `ns`, `us`, `µs`, `ms`, `s` 단위를 ms로 정규화한다.
- 반복 측정 sample에서 median/p90을 계산한다.
- sample 수가 너무 적으면 warning을 남긴다.

## Runtime decision

baseline과 hinted VMFB를 같은 function 기준으로 비교하고 다음 상태를 낸다.

- `promote-candidate`: hinted median runtime이 baseline보다 충분히 빠름
- `keep-baseline`: hinted가 baseline과 비슷하거나 근거가 약함
- `regression`: hinted가 baseline보다 느림
- `needs-more-runs`: parse 가능한 runtime sample이 부족함
- `blocked`: baseline 실행 실패 또는 correctness mismatch

`promote-candidate`도 최종 확정이 아니다. representative workload, backend, target CPU에서 반복 검증해야 한다.

## Correctness boundary

Runtime speed와 correctness는 별도 조건이다. `--correctness-checked`를 명시하지 않으면 decision summary는 `correctness=not-checked`로 남는다. 이 상태에서는 speedup이 좋아도 transform hint를 기본값으로 승격하지 않는다.

## Why this matters

IREE compile success is not performance evidence. This patch makes the next step explicit:

```text
compiler_hints.md
↓
iree_benchmark_plan.md
↓
npm run benchmark:iree
↓
iree_runtime_decision.md
↓
promote / keep baseline / regression / needs more runs
```

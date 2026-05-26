# v12 Purpose Gate and External Runner Hardening

TileForge의 목적은 빠른 estimate를 그대로 최종값처럼 포장하는 것이 아니라, 다음 세 단계의 의사결정을 빠르게 좁히는 것이다.

1. 하드웨어 설계 후보를 좁힌다.
2. 타일링 전략 후보를 고른다.
3. IREE compiler lowering/benchmark 후보를 만든다.

v12에서는 이 세 목적을 하나의 점수로 섞지 않고 `purpose_gate.md/json`으로 분리했다.

## Purpose Validation Gate

모든 full-pipeline job은 다음 artifact를 생성한다.

- `purpose_gate.json`
- `purpose_gate.md`

각 목적별 상태는 다음 중 하나다.

| 상태              | 의미                                               |
| ----------------- | -------------------------------------------------- |
| `ready`           | 현재 evidence로 해당 목적에 사용해도 비교적 안전함 |
| `needs-benchmark` | 후보로는 좋지만 benchmark가 필요함                 |
| `validate-first`  | 먼저 SCALE-Sim 또는 top-k 비교 검증이 필요함       |
| `blocked`         | 외부 도구 실패 등으로 해당 목적에 쓰면 안 됨       |

## 목적별 기준

| 목적            | 기준 지표             | 승격 조건                                           |
| --------------- | --------------------- | --------------------------------------------------- |
| hardware-design | full-layer cycles     | SCALE-Sim ratio와 confidence가 안정적이어야 함      |
| tiling-strategy | tile-policy ranking   | top-k SCALE-Sim regret이 낮아야 함                  |
| iree-options    | runtime A-B benchmark | IREE compile만으로는 부족하고 runtime 비교가 필요함 |

## Worker 책임 분리

기존 `workerRunner.ts`는 job orchestration, SCALE-Sim 실행, IREE 실행, raw output pruning, integrity refresh를 모두 갖고 있었다. v12에서는 외부 실행 계층을 다음 파일로 분리했다.

- `src/server/externalJobRunners.ts`

이제 `workerRunner.ts`는 job state machine과 artifact orchestration에 집중하고, 외부 tool execution은 별도 모듈에서 담당한다.

## UI 반영

Report 탭에서 선택한 job의 `purpose_gate.md`를 바로 보여준다. 따라서 사용자는 `report.md`를 본 뒤, 이 결과를 하드웨어 설계에 바로 써도 되는지, 타일 전략 후보로만 봐야 하는지, IREE runtime benchmark가 필요한지를 한 화면에서 판단할 수 있다.

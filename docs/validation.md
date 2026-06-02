# Validation Strategy

TileForge validation은 입력 검증, estimator 단위 테스트, artifact contract, 외부 도구 integration, production release check로 나뉩니다.

## 검증 계층

| 계층 | 목적 | 대표 명령 |
|---|---|---|
| Type check | TypeScript 타입 안정성 | `npm run typecheck` |
| Smoke | 기본 estimate path 확인 | `npm run smoke` |
| Unit | estimator, parsing, scoring, artifact 로직 | `npm run test:unit` |
| Docs/examples | 문서/예제 명령 유지 | `npm run test:extras` |
| Mock external | SCALE-Sim/IREE 없는 환경의 integration | `npm run validate:external:mock` |
| Required external | 실제 SCALE-Sim/IREE 실행 검증 | `npm run validate:external:required` |
| E2E | 브라우저 UI 흐름 | `npm run test:e2e` |
| Release cleanup | 불필요 artifact 혼입 방지 | `npm run check:clean` |

## 기본 검증 순서

개발 중:

```bash
npm run test:basic
npm run test:unit
```

문서/예제까지:

```bash
npm run test:extras
```

전체 기본 검증:

```bash
npm run test:all
```

실제 외부 도구 검증:

```bash
npm run validate:external:required
```

릴리스 전:

```bash
npm run clean:generated
npm run check:clean
npm run test:all
npm run validate:external:required
npm run release:zip
```

## 테스트 범위

| 영역 | 관련 테스트 예시 |
|---|---|
| estimator | `tests/estimator.test.ts`, `tests/fullLayerEstimator.test.ts` |
| target scope | `tests/estimatorTargetScope.test.ts`, `tests/estimatorSuitePipelines.test.ts` |
| design-space | `tests/designSpace.test.ts`, `tests/designSpaceActiveLearning.test.ts` |
| artifacts | `tests/artifact-integrity.test.ts`, `tests/artifactGuide.test.ts` |
| SCALE-Sim/IREE | `tests/external-tools.test.ts`, `tests/scaleSimReport.test.ts`, `tests/ireeRuntimeEvidence.test.ts` |
| API contract | `tests/api-contract.test.ts`, `tests/resultViewContracts.test.ts` |
| validation/report | `tests/validation*.test.ts`, `tests/predictionRiskRegister.test.ts` |
| property/metamorphic | `tests/property.test.ts`, `tests/metamorphic.test.ts` |
| examples/windows | `tests/examples.test.ts`, scripts test |

## 수치 검증 가이드

TileForge는 simulator/실측 도구가 아니므로 수치 검증은 “예측이 충분히 가까운가”보다 “어떤 target끼리 비교했는가”가 먼저입니다.

권장 확인:

1. full-layer cycle은 SCALE-Sim full topology cycle과 비교합니다.
2. tile-policy cycle은 tile 후보 ranking이나 top-k micro-run과 비교합니다.
3. total cycle이 workload scale 변화 때문에 작아진 경우, `ops/cycle`도 함께 봅니다.
4. SRAM/DRAM bytes는 cycle이 아니라 memory traffic 진단값으로 봅니다.
5. Estimator Suite active model은 readiness와 confidence를 함께 확인합니다.

## Acceptance guide

프로젝트 보고서용 권장 기준:

| 항목 | 권장 기준 |
|---|---|
| TypeScript | `npm run typecheck` 통과 |
| Unit test | `npm run test:unit` 통과 |
| Docs/examples | `npm run test:extras` 통과 |
| Mock external | `validate:external:mock` 통과 |
| 실제 외부 검증 | 대표 workload에서 `validate:external:required` 또는 full-pipeline job 성공 |
| Report | 외부 도구 적용 상태와 skipped/failed 상태가 명확히 표시 |
| Artifact | `artifact_integrity.json` 생성 |
| Cleanup | `check:clean` 통과 |

## 외부 검증 결과 해석

- `SCALE-Sim = 적용됨`: cycle 비교 가능
- `IREE compile = 적용됨`: MLIR compile 가능성 확인
- `skipped`: 도구 미설정 또는 optional stage 생략
- `failed`: 도구는 실행됐지만 command 오류 발생. raw log 확인 필요

## 재현성

재현을 위해 보관할 것:

- source release zip
- job bundle zip
- `.env`의 외부 도구 command, 단 비밀정보가 없을 때만
- OS/Python/Node 버전
- SCALE-Sim fork/commit
- IREE package version
- job `project.json`
- `artifact_integrity.json`

## CI와 로컬의 차이

CI 또는 샌드박스에는 SCALE-Sim/IREE가 없을 수 있습니다. 이 경우 mock 검증은 integration path만 확인합니다. 실제 성능 검증은 로컬 환경에서 `validate:external:required`와 full-pipeline job으로 별도 수행해야 합니다.

# TileForge Documentation Index

이 디렉터리는 TileForge production handoff를 위한 공식 문서 모음입니다. 문서의 기준 버전은 `package.json`의 `0.13.0`이며, 로컬 실행 artifact나 과거 패치 로그는 문서 범위에서 제외합니다.

## 추천 읽는 순서

1. [`product-overview.md`](product-overview.md) — TileForge가 무엇을 해결하는지 먼저 봅니다.
2. [`architecture.md`](architecture.md) — 코드가 어떤 계층으로 나뉘는지 확인합니다.
3. [`pipeline.md`](pipeline.md) — 사용자가 버튼을 누른 뒤 어떤 단계가 실행되는지 따라갑니다.
4. [`user-guide.md`](user-guide.md) — 설치, 실행, UI 사용법을 봅니다.
5. [`artifact-schema.md`](artifact-schema.md) — 결과물을 어떻게 읽고 보관할지 확인합니다.
6. [`validation.md`](validation.md) — production 제출 전에 어떤 검증을 할지 확인합니다.
7. [`production-handoff.md`](production-handoff.md) — 최종 정리 체크리스트를 실행합니다.

## 문서별 역할

| 문서 | 대상 | 핵심 내용 |
|---|---|---|
| [`product-overview.md`](product-overview.md) | 발표/보고서/초기 독자 | 목적, 사용처, 범위, 한계 |
| [`architecture.md`](architecture.md) | 개발자 | `src/app`, `src/lib`, `src/server`, `scripts`, `schemas` 구조 |
| [`pipeline.md`](pipeline.md) | 개발자/검증자 | estimator, full-pipeline, 외부 도구, report 생성 흐름 |
| [`user-guide.md`](user-guide.md) | 사용자 | 설치, UI 입력, 실행, 보고서 해석 |
| [`api-reference.md`](api-reference.md) | 개발자 | API route, 주요 script, request/response 용도 |
| [`artifact-schema.md`](artifact-schema.md) | 검증자/제출자 | job artifact 목록, schema version, checksum |
| [`estimator-model.md`](estimator-model.md) | 알고리즘 설명 | analytical estimator, full-layer/tile-policy 구분 |
| [`scoped-estimator-pipeline.md`](scoped-estimator-pipeline.md) | 학습형 estimator 사용자 | dataset scope 분리, train/evaluate 규칙 |
| [`estimator-suite.md`](estimator-suite.md) | 실험 반복 사용자 | sample 수집, 학습, active model 적용 |
| [`estimator-suite-readiness.md`](estimator-suite-readiness.md) | 검증자 | ready/caution/blocked gate |
| [`design-space.md`](design-space.md) | 하드웨어 탐색 사용자 | sweet spot, Pareto, ROI, uncertainty |
| [`prediction-contract.md`](prediction-contract.md) | 보고서 해석자 | 어떤 수치를 어떤 의미로 읽어야 하는지 |
| [`external-tools.md`](external-tools.md) | 설치 담당자 | SCALE-Sim/IREE 설치, 환경 변수, 실패 대응 |
| [`validation.md`](validation.md) | 릴리스 담당자 | 테스트 계층, acceptance guide, release check |
| [`troubleshooting.md`](troubleshooting.md) | 운영자 | 자주 발생하는 문제와 복구 절차 |
| [`stability-performance.md`](stability-performance.md) | 운영자/개발자 | job store, cache, 병렬 실행, 안정성 설계 |
| [`learned-estimator-lab.md`](learned-estimator-lab.md) | 실험 담당자 | dataset 생성, 학습, 비교 실험 |
| [`purpose-aligned-pipeline.md`](purpose-aligned-pipeline.md) | 발표/보고서 | 프로젝트 목적과 pipeline 설계의 연결 |
| [`research-references.md`](research-references.md) | 보고서 작성자 | 관련 논문/공식 문서/읽는 순서 |
| [`production-handoff.md`](production-handoff.md) | 최종 제출자 | 정리, 검증, zip 생성 체크리스트 |
| [`glossary.md`](glossary.md) | 전체 사용자 | 핵심 용어 정리 |

## 문서 유지 원칙

- README에는 가장 짧은 실행/목차만 둡니다.
- 세부 설명은 `docs/` 아래 주제별 문서에 둡니다.
- 로컬 job 결과, `.env`, `.tileforge`, `.next`, `node_modules`, `external/`은 문서나 release zip에 포함하지 않습니다.
- 실험 수치가 특정 환경에 의존하면 문서 본문에 고정하지 말고 job artifact/report로 남깁니다.
- SCALE-Sim/IREE의 실제 동작이 바뀌면 [`external-tools.md`](external-tools.md)와 [`validation.md`](validation.md)를 먼저 업데이트합니다.

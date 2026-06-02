# API and Script Reference

## API routes

TileForge API는 Next.js App Router route로 구성됩니다. 내부 UI가 사용하는 API지만, 개발/디버깅 시 curl이나 API client로 직접 호출할 수 있습니다.

| Method/Route | 용도 | 비고 |
|---|---|---|
| `POST /api/estimate` | 외부 도구 없이 estimator preview 생성 | `SearchRequest` 입력 |
| `POST /api/dry-run` | 입력과 artifact 생성 가능성 quick check | full job 생성 없음 |
| `POST /api/jobs` | full-pipeline job 생성 | worker가 처리 |
| `GET /api/jobs` | job 목록 조회 | pagination/filter 지원 |
| `GET /api/jobs/:id` | job 상세 조회 | 상태, progress, artifact metadata |
| `PATCH /api/jobs/:id` | job cancel 요청 | `{ action: "cancel" }` |
| `PATCH /api/jobs` | 여러 job cancel 요청 | `{ action: "cancel", ids: [...] }` |
| `DELETE /api/jobs/:id` | job 삭제 | artifact도 함께 정리 |
| `DELETE /api/jobs` | 여러 job 일괄 삭제 | `{ ids: [...] }`, 대량 정리용 |
| `GET /api/jobs/:id/artifacts` | artifact 목록 조회 | `limit`/`page` pagination 지원 |
| `GET /api/jobs/:id/artifacts/:name` | artifact 다운로드 | path safety 검사 |
| `GET/POST /api/jobs/:id/bundle` | job bundle zip 다운로드 | `POST`는 긴 selected path 목록용 |
| `GET /api/jobs/:id/events` | live event stream | 작업 큐 실시간 로그 |
| `GET /api/jobs/:id/events-log` | 누적 event log 조회 | 재접속 복구용 |
| `GET /api/jobs/:id/external-logs` | SCALE-Sim/IREE 원본 log 조회 | stdout/stderr tail |
| `POST /api/jobs/cleanup` | 오래된 job 정리 | 운영용 |
| `POST /api/cache/cleanup` | cache 정리 | 운영용 |
| `POST /api/calibration` | calibration profile 생성 | predicted/measured sample 입력 |
| `POST /api/import/onnx` | ONNX/JSON shape import | optional `onnx-proto` 사용 |
| `GET/POST/DELETE /api/presets` | preset 조회/저장/삭제 | `presets/default`, `presets/user` |
| `GET/POST /api/project` | project export/import | UI project file |
| `POST /api/report` | report preview 생성 | external merge 전 preview |
| `GET/PATCH /api/env` | `.env` 값 조회/수정. 웹 포트, host, API base URL 포함 | 설정 탭 |
| `GET /api/system/status` | CPU/RAM/job/storage status | 시스템 탭 |
| `GET/PATCH /api/system/config` | 병렬도 등 runtime config | 상태 탭 |
| `POST /api/validation` | validation helper | UI/input 검증 |
| `GET/POST /api/tpu` | TPU benchmark 준비/비교/서버 실행 | 선택적 실측 비교 |
| `GET/POST /api/estimator-suite` | dataset, train, activate | 학습형 correction |
| `GET /api/doctor` | local readiness check | doctor UI |

## `/api/estimator-suite` actions

| Action | 용도 |
|---|---|
| `design` | 현재 request에서 design dataset 후보 생성 |
| `plan` | SCALE-Sim validation sampling plan 생성 |
| `plan-and-queue` | sampling plan 생성 후 job queue 등록 |
| `dataset` | 업로드/수집 CSV를 dataset artifact로 저장 |
| `dataset-job` | dataset 생성 job 등록 |
| `dataset-and-train` | dataset 생성 후 학습 job 등록 |
| `suite-job` | CSV/request 기반 suite 학습 job 등록 |
| `collect-jobs` | 완료 job에서 estimator sample 수집 |
| `split-dataset` | full-layer/tile-policy scope로 dataset 분리 |
| `scope-pipeline` | scope 분리 후 scope별 train/evaluate |
| `split-and-train` | `scope-pipeline` alias |
| `activate` | 학습된 model을 active correction model로 지정 |
| `clear-active` | active model 해제 |

## npm scripts

### setup

| 명령 | 설명 |
|---|---|
| `npm run setup:env` | 외부 도구 명령을 탐색해 `.env`에 저장 |
| `npm run setup:external` | SCALE-Sim + IREE 설치 |
| `npm run setup:scalesim` | SCALE-Sim fork 설치 |
| `npm run setup:iree` | IREE Python package 설치 |
| `npm run setup:fresh` | 생성물/의존성 정리 후 새 환경 구성 |
| `npm run setup:fresh:clean` | install 없이 workspace 정리 |

### dev/production

| 명령 | 설명 |
|---|---|
| `npm run dev` | Next.js dev server + worker 동시 실행 |
| `npm run dev:web` | `.env`의 `TILEFORGE_WEB_PORT`/`TILEFORGE_WEB_HOST`로 웹 서버만 실행 |
| `npm run dev:worker` | worker만 실행 |
| `npm run build` | production build |
| `npm run start` | production Next.js server |
| `npm run worker` | production/development worker |
| `npm run worker:once` | queued job 하나만 처리하고 종료 |

### external tools

| 명령 | 설명 |
|---|---|
| `npm run doctor` | 기본 readiness check |
| `npm run doctor:external` | SCALE-Sim/IREE 감지 확인 |
| `npm run validate:external` | 외부 도구 validation |
| `npm run validate:external:required` | 외부 도구 없으면 실패 처리 |
| `npm run validate:external:mock` | mock SCALE-Sim/IREE로 integration 확인 |
| `npm run run:scalesim` | SCALE-Sim 단독 실행 |
| `npm run run:iree` | IREE compile 단독 실행 |

### test/release

| 명령 | 설명 |
|---|---|
| `npm run typecheck` | TypeScript type check |
| `npm run smoke` | smoke test |
| `npm run test:basic` | typecheck + smoke |
| `npm run test:unit` | 전체 unit test |
| `npm run test:extras` | docs/examples/windows/mock external |
| `npm run test:all` | setup:env + doctor + basic + unit + extras |
| `npm run test:ci` | CI용 전체 테스트 |
| `npm run test:advanced` | property/metamorphic/integration/schema 등 확장 테스트 |
| `npm run test:e2e` | Playwright E2E |
| `npm run clean:generated` | local generated files 정리 |
| `npm run check:clean` | release 불필요 파일 검사 |
| `npm run release:zip` | release zip 생성 |
| `npm run verify:artifacts` | artifact integrity 검증 |

### estimator suite / benchmark

| 명령 | 설명 |
|---|---|
| `npm run estimator:design` | design samples 생성 |
| `npm run estimator:train` | tabular correction model 학습 |
| `npm run estimator:evaluate` | 학습 모델 평가 |
| `npm run estimator:train-neural` | neural residual model 학습 |
| `npm run estimator:evaluate-neural` | neural residual 평가 |
| `npm run estimator:compare` | analytical/learned/neural 비교 |
| `npm run estimator:suite` | Estimator Suite end-to-end 실행 |
| `npm run bench:estimator` | estimator benchmark |
| `npm run bench:memory` | memory benchmark |
| `npm run bench:suite` | suite benchmark |
| `npm run profile:estimator` | estimator profiling |

## 환경 변수 quick reference

| 변수 | 의미 |
|---|---|
| `TILEFORGE_SCALE_SIM_CMD` | SCALE-Sim 실행 명령 |
| `TILEFORGE_IREE_COMPILE_CMD` | IREE compile 실행 명령 |
| `TILEFORGE_MAX_PARALLEL_JOBS` | 동시에 실행할 job 수 |
| `TILEFORGE_WORKSPACE_DIR` | `.tileforge` 대신 사용할 workspace root |
| `TILEFORGE_JOB_STORE` | job store 경로 override |
| `TILEFORGE_CACHE_DIR` | estimator cache 경로 override |
| `TILEFORGE_EXTERNAL_TIMEOUT_MS` | 외부 명령 timeout |
| `TILEFORGE_JOB_TIMEOUT_MS` | job 전체 timeout |
| `TILEFORGE_DISABLE_CACHE` | estimator cache 비활성화 |
| `TILEFORGE_DISABLE_SQLITE` | SQLite job store 비활성화 |
| `TILEFORGE_KEEP_EXTERNAL_RAW` | 외부 도구 raw output 보존 |
| `TILEFORGE_MAX_ARTIFACTS_MB` | job artifact 크기 제한 |
| `TILEFORGE_MAX_BUNDLE_MB` | bundle zip 크기 제한 |
| `TILEFORGE_MAX_CANDIDATES` | estimator candidate guardrail |
| `TILEFORGE_JOBS_DASHBOARD_ARTIFACTS` | job dashboard artifact count까지 eager loading할지 여부 |
| `TILEFORGE_JOBS_ARTIFACT_PREVIEW_LIMIT` | job summary에 포함할 artifact 이름 preview 수 |
| `TILEFORGE_JOBS_FALLBACK_CACHE_MS` | SQLite가 없을 때 파일 기반 job summary cache TTL |
| `TILEFORGE_JOBS_SUMMARY_SCAN_CONCURRENCY` | 파일 기반 job summary scan 동시성 |
| `TILEFORGE_JOBS_API_CACHE_MS` | `/api/jobs` 응답 cache TTL |

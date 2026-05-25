# TileForge Workbench

TileForge Workbench는 GEMM/Conv 연산을 systolic array에서 실행할 때 어떤 하드웨어 설정과 타일 정책이 유리한지 빠르게 탐색하는 로컬 웹 워크벤치입니다. TileForge estimator로 후보를 빠르게 좁힌 뒤, 필요하면 SCALE-Sim과 IREE를 실제로 실행해 예측값을 교차 검증합니다.

## 핵심 기능

- GEMM `M x N x K` workload 분석
- Conv2D를 im2col GEMM으로 변환해 분석
- WS/OS/IS dataflow와 array 크기 비교
- tileM/tileN/tileK 후보 탐색
- cycle, PE 사용률, padding, SRAM, energy, roofline 추정
- SCALE-Sim config/topology/layout 생성 및 실행
- IREE compile용 MLIR/transform artifact 생성
- full-pipeline job queue, 실시간 콘솔 로그, 작업별 보고서 관리
- Markdown 보고서, CSV, JSON, SVG, MLIR, VMFB artifact 저장

## 빠른 시작

처음 클론했거나 작업 환경을 새로 만들 때는 다음 순서를 권장합니다.

```bash
npm install
npm run setup:fresh
npm run doctor
npm run dev
```

이미 의존성이 설치되어 있다면 아래만 실행해도 됩니다.

```bash
npm run setup:env
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

## 외부 도구 설정

TileForge는 최초 실행 시 SCALE-Sim과 IREE 실행 명령을 자동 탐색하고 `.env`에 저장합니다.

```dotenv
TILEFORGE_SCALE_SIM_CMD="py -3 -m scalesim.scale"
TILEFORGE_IREE_COMPILE_CMD="py -3 -m iree.compiler.tools.scripts.iree_compile"
```

Windows에서는 `python3` 대신 `py -3` 또는 `python`을 우선 사용합니다. 도구 위치가 바뀌면 `.env` 값을 직접 수정하거나 다음 명령을 다시 실행하세요.

```bash
npm run setup:env
npm run doctor:external
npm run validate:external:required
```

## 자주 쓰는 명령어

| 명령 | 설명 |
|---|---|
| `npm run dev` | 웹 UI와 worker를 함께 실행합니다. |
| `npm run setup:env` | SCALE-Sim/IREE 실행 명령을 탐색하고 `.env`에 저장합니다. |
| `npm run setup:fresh` | 생성물, 캐시, node_modules를 정리한 뒤 의존성과 `.env`를 다시 구성합니다. |
| `npm run test:all` | 타입 검사, 단위 테스트, mock/real 외부 검증을 묶어 실행합니다. |
| `npm run validate:external:required` | 실제 SCALE-Sim/IREE 연동을 필수 조건으로 검증합니다. |
| `npm run run:scalesim:required` | SCALE-Sim만 단독 검증합니다. |
| `npm run run:iree` | IREE compile만 단독 실행합니다. |
| `npm run jobs:stats` | job 저장소 통계를 출력합니다. |
| `npm run jobs:clean` | 오래된 job artifact를 정리합니다. |

## UI 사용 흐름

1. **프리셋** 탭에서 기본 하드웨어/워크로드를 선택하거나 사용자 프리셋을 불러옵니다.
2. **하드웨어** 탭에서 array 크기, 주파수, SRAM, dataflow를 조정합니다.
3. **타일링** 탭에서 tileM/tileN/tileK 후보와 최적화 목표를 설정합니다.
4. **SCALE-Sim** 탭에서 bandwidth, SRAM 분할, layout/bank 설정을 조정합니다.
5. **워크로드** 또는 **Conv 변환** 탭에서 분석할 shape를 입력합니다.
6. **도구/실행** 탭에서 full-pipeline 작업을 큐에 등록합니다.
7. **작업** 탭에서 queue, 실시간 콘솔, SCALE-Sim/IREE 원본 로그를 확인합니다.
8. **보고서** 탭에서 완료된 작업별 Markdown 보고서를 선택해 확인합니다.

## 보고서 읽는 법

보고서의 핵심은 다음 두 섹션입니다.

- `2-1. 실제 외부 도구 반영 상태`: SCALE-Sim과 IREE 결과가 실제로 반영되었는지 확인합니다.
- `2-2. 예측 결과와 실제 실행 결과 비교`: TileForge estimator cycle과 SCALE-Sim cycle의 차이, 비율, 해석을 확인합니다.

`SCALE-Sim = 적용됨`, `IREE compile = 적용됨`으로 표시되고 VMFB 크기가 0보다 크면 full-pipeline 결과가 정상 반영된 것입니다.

## 저장되는 주요 산출물

| 파일 | 내용 |
|---|---|
| `report.md` | 사람이 읽는 최종 분석 보고서 |
| `external_validation_report.md` | SCALE-Sim/IREE 실제 실행 검증 상세 |
| `best_tile_policy.csv` | 연산별 최적 타일 정책 |
| `scalesim.cfg` | SCALE-Sim 설정 파일 |
| `topology.csv` | SCALE-Sim topology 입력 |
| `layout.csv` | SCALE-Sim layout 입력 |
| `generated.mlir` | IREE compile 입력 MLIR |
| `transform.mlir` | IREE transform dialect 스케치 |
| `iree-output/model.vmfb` | IREE compile 결과 |
| `scalesim-output/.../COMPUTE_REPORT.csv` | SCALE-Sim compute report |

## 문제 해결

### full-pipeline은 성공했는데 보고서가 대기 중으로 보일 때

보고서 탭에서 해당 job의 `report.md`를 선택했는지 확인하세요. UI는 완료된 작업의 report artifact를 자동 갱신하지만, 여러 작업을 동시에 등록한 경우 원하는 작업을 직접 선택하는 것이 가장 확실합니다.

### SCALE-Sim이 `No section: layout`으로 실패할 때

현재 SCALE-Sim fork는 `scalesim.cfg`의 `[layout]` 섹션을 요구합니다. 최신 코드에서는 이 섹션을 항상 생성합니다. 오래된 artifact를 보고 있다면 새 full-pipeline job을 실행하세요.

### Windows에서 Python 명령을 찾지 못할 때

`npm run setup:env`를 다시 실행하세요. 여전히 실패하면 `.env`에 Python 경로를 직접 넣습니다.

```powershell
$env:TILEFORGE_PYTHON="C:\\Users\\사용자\\AppData\\Local\\Programs\\Python\\Python312\\python.exe"
npm run setup:env
```

### IREE compile이 0 byte VMFB를 만들 때

`TILEFORGE_IREE_COMPILE_CMD`가 `iree.compiler.tools.core`를 가리키지 않는지 확인하세요. 권장값은 다음입니다.

```dotenv
TILEFORGE_IREE_COMPILE_CMD="py -3 -m iree.compiler.tools.scripts.iree_compile"
```

## 디렉터리 구조

```text
src/app       Next.js UI와 API route
src/lib       estimator, report, SCALE-Sim/IREE artifact 생성
src/server    job store, worker, 외부 명령 실행
scripts       개발/검증/설치/정리 스크립트
tests         Vitest 기반 테스트
schemas       artifact JSON schema
docs          설계와 운영 문서
examples      예제 workload와 calibration 파일
```

## 권장 개발 루틴

```bash
npm run setup:env
npm run typecheck
npm test
npm run validate:external:required
npm run dev
```

작업 결과가 이상하면 먼저 **작업 탭의 실시간 콘솔**, **SCALE-Sim/IREE 원본 로그**, **보고서 2-1/2-2 섹션**을 확인하세요.


## 병렬 작업과 캐시

TileForge worker는 큐에 쌓인 작업을 병렬로 실행할 수 있습니다. 기본 병렬도는 2이며, 필요하면 `.env` 또는 PowerShell 환경변수로 조정합니다.

```powershell
$env:TILEFORGE_MAX_PARALLEL_JOBS="4"
npm run dev
```

상태 탭에서는 서버 CPU 사용률, 코어별 사용률, RAM 사용률, 현재 running/queued 작업 수와 남은 병렬 슬롯을 확인할 수 있습니다. 동일 입력의 estimator 결과는 `.tileforge/cache`에 저장되어 재사용됩니다. 캐시를 끄려면 `TILEFORGE_DISABLE_CACHE=1`을 설정하세요.

## 병렬 실행 설정

TileForge는 `.env`의 `TILEFORGE_MAX_PARALLEL_JOBS` 값을 기준으로 큐에 있는 작업을 동시에 실행합니다.

```dotenv
TILEFORGE_MAX_PARALLEL_JOBS="2"
```

웹 UI의 **상태 > 서버 리소스 > 병렬 실행 수**에서도 이 값을 바꿀 수 있습니다. 저장하면 `.env`에 반영되고, 별도 worker 프로세스도 다음 큐 폴링부터 새 값을 읽습니다.

## 테스트 명령 정리

테스트는 다음 네 묶음으로 정리했습니다.

```powershell
npm run test:basic     # typecheck + smoke
npm run test:unit      # 핵심 estimator/validation/workbench 단위 테스트
npm run test:extras    # 문서/예제/Windows 스크립트/mock 외부 검증
npm run test:advanced  # property/metamorphic/integration/schema 등 확장 검증
npm run test:all       # setup:env + doctor + basic + unit + extras
```

일상적인 확인은 `npm run test:all`을 권장하고, 릴리스 전에는 `npm run test:ci`로 advanced 테스트까지 실행하면 됩니다.



## SCALE-Sim 회귀 보정 워크플로우

Estimator가 SCALE-Sim보다 지속적으로 높거나 낮게 예측한다면 `calibrate:scalesim` 스크립트로 보정 profile을 만들 수 있습니다.

```powershell
npm run dev
# 다른 터미널에서
npm run calibrate:scalesim:quick
```

이 스크립트는 로컬 서버의 `/api/jobs`에 여러 full-pipeline 작업을 넣고, 완료된 작업의 `scalesim_summary.json`과 TileForge estimator 결과를 비교해 `profiles/scalesim-regression-profile.json`을 생성합니다. 생성된 보정 profile은 `measured / predicted` 비율을 기반으로 estimator의 1차 보정 계수를 제공합니다. SCALE-Sim 버전, layout 정책, hardware preset이 바뀌면 다시 생성하는 것을 권장합니다.

## layout.csv는 누가 정하는가?

`topology.csv`는 모델의 layer shape를 정의합니다. 즉, 어떤 layer가 있고 M/N/K 또는 Conv shape가 무엇인지는 topology가 결정합니다. 반면 `layout.csv`는 같은 layer를 SCALE-Sim 내부에서 어떤 operand layout, bank layout, interline/intraline order로 배치할지 알려주는 실행/메모리 배치 힌트입니다.

따라서 layout은 모델 topology에서 자동으로 유도되는 값이라기보다, **사용자가 하드웨어 메모리 배치 정책을 실험하기 위해 지정하는 값**에 가깝습니다. 한 파일에 여러 layer 행이 있는 이유는 topology의 여러 layer에 대해 각 layer별 layout 정책을 따로 줄 수 있기 때문입니다. 기본값은 안전한 identity-like order를 사용하고, custom layout을 켜면 이 값을 의도적으로 바꾸어 SRAM bank/layout 효과를 실험합니다.

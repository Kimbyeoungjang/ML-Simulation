# External Tools: SCALE-Sim and IREE

TileForge는 estimator만으로도 동작하지만, production report에서 신뢰도 있는 결론을 내려면 SCALE-Sim/IREE 검증을 함께 사용하는 것이 좋습니다.

## 한 번에 설치

```bash
npm run setup:external
```

이 명령은 다음을 순서대로 실행합니다.

```bash
npm run setup:scalesim
npm run setup:iree
npm run setup:env
```

## SCALE-Sim

TileForge는 기본적으로 프로젝트에서 사용한 SCALE-Sim fork를 설치 대상으로 둡니다.

```bash
npm run setup:scalesim -- --force
```

기본 repository:

```text
https://github.com/Kimbyeoungjang/SCALE-Sim
```

다른 fork를 쓰려면:

```bash
TILEFORGE_SCALE_SIM_REPO="https://github.com/<owner>/SCALE-Sim" npm run setup:scalesim -- --force
```

PowerShell:

```powershell
$env:TILEFORGE_SCALE_SIM_REPO="https://github.com/<owner>/SCALE-Sim"
npm run setup:scalesim -- --force
```

권장 실행 명령:

```dotenv
TILEFORGE_SCALE_SIM_CMD="py -3 -m scalesim.scale"
```

macOS/Linux에서는 다음 형태도 자주 사용됩니다.

```dotenv
TILEFORGE_SCALE_SIM_CMD="python3 -m scalesim.scale"
```

## IREE

```bash
npm run setup:iree
```

설치 대상 Python package:

```text
iree-base-compiler
iree-base-runtime
```

권장 compile 명령:

```dotenv
TILEFORGE_IREE_COMPILE_CMD="py -3 -m iree.compiler.tools.scripts.iree_compile"
```

macOS/Linux 예시:

```dotenv
TILEFORGE_IREE_COMPILE_CMD="python3 -m iree.compiler.tools.scripts.iree_compile"
```

## Python 탐색 순서

Windows:

```text
py -3 → python → python3
```

macOS/Linux:

```text
python3 → python → py -3
```

자동 탐색이 실패하면 직접 지정합니다.

```powershell
$env:TILEFORGE_PYTHON="C:\Users\사용자\AppData\Local\Programs\Python\Python312\python.exe"
npm run setup:external
```

## 환경 확인

```bash
npm run setup:env
npm run doctor:external
npm run validate:external:required
```

외부 도구가 없는 CI/샌드박스에서는 mock으로 최소 검증합니다.

```bash
npm run validate:external:mock
```

## `.env` 예시

```dotenv
TILEFORGE_SCALE_SIM_CMD="py -3 -m scalesim.scale"
TILEFORGE_IREE_COMPILE_CMD="py -3 -m iree.compiler.tools.scripts.iree_compile"
TILEFORGE_EXTERNAL_TIMEOUT_MS="180000"
TILEFORGE_KEEP_EXTERNAL_RAW="0"
```

## SCALE-Sim artifact

TileForge가 생성하는 입력:

- `scalesim.cfg`
- `topology.csv`
- `layout.csv`
- `topology_top3.csv`
- `layout_top3.csv`

SCALE-Sim에서 읽는 핵심 output:

- `COMPUTE_REPORT.csv`
- SRAM/DRAM access report
- stdout/stderr/exit code

## IREE artifact

TileForge가 생성하는 입력:

- `generated.mlir`
- `transform.mlir`
- `iree-command.sh`

IREE compile 결과:

- `model.vmfb`
- stdout/stderr/exit code
- warning/error log

## 흔한 문제

### `No section: layout`

현재 fork는 config의 layout section 또는 layout 파일을 요구할 수 있습니다. 최신 TileForge는 `layout.csv`와 `[layout]` section을 생성합니다. 오래된 artifact를 보고 있다면 새 job을 실행하세요.

### Python 명령을 못 찾음

`npm run setup:env`를 다시 실행하거나 `TILEFORGE_PYTHON`을 지정하세요.

### IREE VMFB가 0 byte

`TILEFORGE_IREE_COMPILE_CMD`가 권장 명령을 가리키는지 확인하고, 작업 큐의 IREE stderr를 확인하세요.

### 외부 도구는 설치됐지만 job에서 skipped

`.env`가 Next.js/worker 프로세스 시작 전에 로드됐는지 확인하세요. `.env` 수정 후에는 웹/worker 프로세스를 재시작하는 것이 안전합니다.

## 검증 기준

production report에서 “외부 검증 적용”이라고 말하려면 다음을 확인합니다.

- SCALE-Sim stage가 exit code 0으로 종료
- `COMPUTE_REPORT.csv`가 parsing됨
- report의 외부 도구 반영 상태가 `적용됨`
- IREE stage가 exit code 0으로 종료
- VMFB size가 0보다 큼
- raw log artifact가 존재하거나 UI에서 조회 가능

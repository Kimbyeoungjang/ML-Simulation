import Link from "next/link";

export const metadata = {
  title: "TileForge 도움말",
  description: "TileForge Workbench 사용법, 입력값 의미, 보고서 해석, 외부 도구 설정 안내",
};

const quickSteps = [
  ["1", "환경 구성", "npm run setup:env로 SCALE-Sim/IREE 명령과 병렬 작업 수를 .env에 고정합니다."],
  ["2", "입력 설정", "프리셋, 하드웨어, 타일링, 워크로드, SCALE-Sim 탭에서 실험 조건을 정합니다."],
  ["3", "작업 실행", "도구/실행 탭에서 full-pipeline을 큐에 넣고, 작업 탭에서 진행 로그와 외부 도구 로그를 확인합니다."],
  ["4", "결과 확인", "보고서 탭에서 완료된 job의 report.md를 선택하고 2-1/2-2 섹션을 확인합니다."],
];

const conceptRows = [
  ["Systolic array", "PE가 격자 형태로 배치된 행렬곱 가속기 구조입니다. arrayRows×arrayCols가 클수록 peak MAC 수는 늘지만, 타일 shape가 맞지 않으면 utilization이 낮아질 수 있습니다."],
  ["Dataflow", "데이터를 array 내부에 오래 머무르게 하는 기준입니다. WS는 weight, OS는 output, IS는 input을 중심으로 재사용합니다. TileForge에서는 여러 dataflow를 동시에 선택해 job을 나누어 비교할 수 있습니다."],
  ["M/N/K", "GEMM C[M×N] = A[M×K] × B[K×N]의 차원입니다. Transformer에서는 M이 token 수, N이 출력 hidden 차원, K가 입력 hidden/reduction 차원인 경우가 많습니다."],
  ["TileM/N/K", "하나의 연산을 작은 GEMM 블록으로 나누는 크기입니다. 타일이 너무 크면 SRAM을 초과하고, 너무 작으면 array utilization과 재사용성이 떨어질 수 있습니다."],
  ["PE 사용률", "실제 유효 MAC이 array capacity를 얼마나 채우는지 나타냅니다. 낮으면 M/N/K 또는 tile shape가 array와 잘 맞지 않는다는 신호입니다."],
  ["패딩 비율", "타일 경계에서 남는 빈 계산 비율입니다. M/N/K가 tile 크기로 나누어떨어지지 않을 때 커집니다."],
  ["SCALE-Sim", "systolic array cycle과 memory access를 외부 시뮬레이터로 검증하는 단계입니다. TileForge estimator와 비교해 보수성/낙관성을 판단합니다."],
  ["IREE compile", "generated.mlir이 실제 컴파일러를 통과하는지 확인하는 단계입니다. VMFB 생성은 컴파일 가능성 검증이며 런타임 cycle 측정값은 아닙니다."],
  ["보정", "실측 cycle 또는 외부 도구 결과와 estimator 차이를 sample로 넣어 이후 예측에 보정 계수를 곱하는 기능입니다."],
];

const inputSections = [
  ["프리셋", "공개 사양 기반 근사 하드웨어와 대표 workload를 빠르게 적용합니다. 사용자 프리셋은 presets/user 폴더에 저장되어 서버를 재시작해도 유지됩니다."],
  ["하드웨어", "array 크기, 주파수, SRAM, dataflow, memory bandwidth, energy parameter를 설정합니다. 여러 dataflow를 선택하면 각각 별도 job으로 큐에 들어갑니다."],
  ["타일링", "tileM/tileN/tileK 후보와 최적화 목표를 지정합니다. tileM/tileN은 공간 PE 활용률과 padding에, tileK는 reduction 재사용과 SRAM working set에 영향을 줍니다. 목표별 score 가중치도 이 탭에서 확인합니다."],
  ["SCALE-Sim", "DRAM/Interface bandwidth, operand별 SRAM, offset, layout.csv, SRAM bank와 custom layout 옵션을 조정합니다."],
  ["워크로드", "프리셋, 간편 M/N/K 입력, CSV, ONNX/JSON import로 GEMM shape를 구성합니다."],
  ["Conv 변환", "Conv2D를 im2col GEMM으로 바꿉니다. M=batch×outputH×outputW, N=outputC, K=inputC×kernelH×kernelW입니다."],
  ["보정", "간편 sample 입력 또는 raw CSV로 보정 계수를 만듭니다. 실측값이 많을수록 신뢰도가 올라갑니다."],
  ["도구/실행", "server estimate, full-pipeline, 환경 진단, 프로젝트 저장/불러오기를 실행합니다."],
];

const reportGuide = [
  ["2-1. 실제 외부 도구 반영 상태", "SCALE-Sim과 IREE 결과가 report.md에 실제로 반영되었는지 한눈에 봅니다. 두 항목이 적용됨이면 estimator 단독 결과가 아닙니다."],
  ["2-2. 예측 결과와 실제 실행 결과 비교", "TileForge estimator cycle과 SCALE-Sim cycle의 차이, 비율, 해석을 확인합니다. 비율이 1보다 크면 SCALE-Sim이 더 보수적인 경우입니다."],
  ["최적 타일 정책", "연산별 선택된 tileM×tileN×tileK, cycle, utilization, padding, SRAM 요구량을 확인합니다."],
  ["그래프 탭", "cycle, 실행 시간, utilization, SRAM/cache working set, DRAM traffic 등 여러 지표로 후보 타일 성능을 비교합니다."],
  ["SCALE-Sim/IREE 원본 로그", "외부 도구가 실제로 실행한 명령, cwd, stdout, stderr, exitCode를 확인합니다."],
];

export default function HelpPage() {
  return (
    <main>
      <header className="topbar">
        <div>
          <h1>TileForge 도움말</h1>
          <p className="lead">
            TileForge를 처음 실행하는 방법부터 입력값의 의미, full-pipeline 결과 해석까지 정리했습니다.
          </p>
        </div>
        <Link className="help-link" href="/">워크벤치로 돌아가기</Link>
      </header>

      <section className="panel doc">
        <h2>빠른 시작</h2>
        <pre className="md-code"><code>{`npm run setup:env
npm run dev`}</code></pre>
        <p>깨끗한 환경에서 다시 구성하려면 다음 명령을 사용합니다.</p>
        <pre className="md-code"><code>{`npm run setup:fresh
npm run dev`}</code></pre>
        <div className="help-grid">
          {quickSteps.map(([num, title, text]) => (
            <div className="help-card" key={num}>
              <span className="badge">STEP {num}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="panel doc">
        <h2>기초 개념</h2>
        <table>
          <thead><tr><th>개념</th><th>설명</th></tr></thead>
          <tbody>{conceptRows.map(([name, desc]) => <tr key={name}><td><b>{name}</b></td><td>{desc}</td></tr>)}</tbody>
        </table>
      </section>

      <section className="panel doc">
        <h2>입력 탭 설명</h2>
        <table>
          <thead><tr><th>탭</th><th>용도</th></tr></thead>
          <tbody>{inputSections.map(([name, desc]) => <tr key={name}><td><b>{name}</b></td><td>{desc}</td></tr>)}</tbody>
        </table>
      </section>

      <section className="panel doc">
        <h2>타일링과 목표 함수</h2>
        <p>TileForge의 score는 낮을수록 좋은 후보를 뜻합니다. 모든 목표는 cycle, PE 사용률, padding, SRAM 초과 위험을 보지만 어느 항목을 더 강하게 볼지 다릅니다.</p>
        <table>
          <thead><tr><th>목표</th><th>가중치 해석</th></tr></thead>
          <tbody>
            <tr><td><b>균형</b></td><td>cycle을 중심으로 보되 PE 미사용, padding, SRAM 초과 penalty를 함께 반영합니다.</td></tr>
            <tr><td><b>사이클 최소</b></td><td>전체 cycle을 가장 강하게 줄이고, SRAM 초과만 큰 penalty로 둡니다.</td></tr>
            <tr><td><b>활용률 우선</b></td><td>PE 사용률을 우선해 array를 꽉 채우는 tile을 고릅니다.</td></tr>
            <tr><td><b>하드웨어 설계</b></td><td>cycle, utilization, padding, 경계 타일 penalty를 함께 보며 array 크기 비교에 적합합니다.</td></tr>
            <tr><td><b>Pareto 후보</b></td><td>cycle/SRAM/padding/utilization 중 하나라도 강점이 있는 후보를 넓게 남깁니다.</td></tr>
          </tbody>
        </table>
      </section>

      <section className="panel doc">
        <h2>SCALE-Sim 탭의 주요 값</h2>
        <ul>
          <li><b>DRAM / Interface Bandwidth</b>: SCALE-Sim의 외부 메모리 대역폭 모델에 들어갑니다.</li>
          <li><b>Ifmap/Filter/Ofmap SRAM</b>: 입력 feature, weight/filter, output feature map을 담는 온칩 버퍼 크기입니다.</li>
          <li><b>Offset</b>: 각 tensor의 주소 공간 시작점입니다. 서로 겹치지 않게 두면 memory trace 해석이 쉬워집니다.</li>
          <li><b>layout.csv 사용</b>: SCALE-Sim에 -l layout.csv를 넘깁니다. custom layout을 쓸 때 필요합니다.</li>
          <li><b>custom layout/bank 값</b>: SRAM bank와 layout 순서를 바꾸는 고급 설정입니다. custom layout을 켜면 IFMAP/FILTER layout 순서가 SCALE-Sim의 transpose 축으로 들어가므로 중복 축이 없어야 합니다. TileForge는 안전한 기본 order를 생성합니다.</li>
        </ul>
      </section>

      <section className="panel doc">
        <h2>작업 큐와 실시간 콘솔</h2>
        <p>full-pipeline을 여러 번 실행하면 작업은 큐에 등록됩니다. 병렬 실행 수는 <code>TILEFORGE_MAX_PARALLEL_JOBS</code> 또는 상태 탭에서 변경할 수 있습니다.</p>
        <ul>
          <li><b>실시간 콘솔</b>: TileForge worker의 진행 로그를 CMD처럼 보여줍니다.</li>
          <li><b>원본 외부 도구 로그</b>: SCALE-Sim과 IREE의 stdout/stderr를 tail합니다.</li>
          <li><b>다중 삭제</b>: 작업 큐에서 여러 작업을 체크해 한 번에 삭제할 수 있습니다.</li>
        </ul>
      </section>

      <section className="panel doc">
        <h2>Conv 변환과 보정 입력</h2>
        <p>Conv 변환 탭의 숫자들은 im2col GEMM의 M/N/K를 만드는 원천 값입니다. <code>outputC</code>는 N, <code>inputC×kernelH×kernelW</code>는 K, <code>batch×outputH×outputW</code>는 M이 됩니다.</p>
        <p>보정 탭에서는 estimator의 predicted cycle과 SCALE-Sim 또는 실측 measured cycle을 넣습니다. sample이 많을수록 confidence의 불확실성이 줄어듭니다.</p>
      </section>

      <section className="panel doc">
        <h2>보고서 읽는 법</h2>
        <table>
          <thead><tr><th>확인 위치</th><th>의미</th></tr></thead>
          <tbody>{reportGuide.map(([name, desc]) => <tr key={name}><td><b>{name}</b></td><td>{desc}</td></tr>)}</tbody>
        </table>
        <p><code>SCALE-Sim = 적용됨</code>, <code>IREE compile = 적용됨</code>으로 표시되고 VMFB 크기가 0보다 크면 실제 외부 도구 결과가 정상 반영된 것입니다.</p>
      </section>

      <section className="panel doc">
        <h2>외부 도구 설정</h2>
        <p>TileForge는 최초 실행 시 사용 가능한 SCALE-Sim/IREE 명령을 찾아 <code>.env</code>에 저장합니다.</p>
        <pre className="md-code"><code>{`TILEFORGE_SCALE_SIM_CMD="py -3 -m scalesim.scale"
TILEFORGE_IREE_COMPILE_CMD="py -3 -m iree.compiler.tools.scripts.iree_compile"
TILEFORGE_MAX_PARALLEL_JOBS="2"`}</code></pre>
      </section>

      <section className="panel doc">
        <h2>문제 해결</h2>
        <h3>SCALE-Sim이 실패할 때</h3>
        <p>작업 탭의 원본 로그에서 traceback, cfg section, layout order, topology header를 확인하세요.</p>
        <h3>보고서가 대기 중으로 보일 때</h3>
        <p>보고서 탭에서 완료된 job의 report.md를 선택했는지 확인하세요. Estimator 미리보기 보고서는 외부 도구 상태가 대기 중으로 표시됩니다.</p>
        <h3>IREE warning이 보일 때</h3>
        <p>exitCode가 0이면 compile은 성공한 것입니다. warning은 generated.mlir의 안전성/초기화 경고일 수 있습니다.</p>
      </section>
    
      <section className="doc-section">
        <h2>SCALE-Sim 회귀 보정</h2>
        <p>
          여러 하드웨어/워크로드/dataflow 조합을 SCALE-Sim으로 실제 실행한 뒤 TileForge estimator와 비교하면,
          estimator가 어느 방향으로 치우치는지 확인할 수 있습니다. <code>npm run estimator:suite</code>은
          빠른 샘플 sweep을 큐에 넣고 완료 결과를 모아 <code>profiles/scalesim-regression-profile.json</code>을 만듭니다.
        </p>
        <p>
          이 profile은 SCALE-Sim measured cycle과 estimator predicted cycle의 비율을 기반으로 한 1차 보정값입니다.
          SCALE-Sim 버전, layout 정책, SRAM/DRAM 설정이 바뀌면 보정 profile도 다시 만드는 것이 좋습니다.
        </p>
      </section>
      <section className="doc-section">
        <h2>layout.csv와 topology.csv의 역할</h2>
        <p>
          topology는 모델 layer의 shape를 정의하고, layout은 그 layer를 SCALE-Sim 내부에서 어떤 operand/bank layout으로
          배치할지를 정합니다. 즉 layout은 모델 자체의 구조라기보다 메모리 배치 실험을 위한 설정입니다.
        </p>
      </section>
    </main>
  );
}

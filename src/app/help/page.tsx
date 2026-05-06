import Link from "next/link";

export const metadata = {
  title: "TileForge 도움말",
  description: "TileForge Workbench 사용법, 보고서 읽는 법, 외부 도구 설정 안내",
};

const quickSteps = [
  ["1", "환경 구성", "npm run setup:env로 SCALE-Sim/IREE 명령을 .env에 저장합니다."],
  ["2", "입력 설정", "프리셋, 하드웨어, 타일링, 워크로드 탭에서 실험 조건을 정합니다."],
  ["3", "작업 실행", "도구/실행 탭에서 full-pipeline을 큐에 넣고 작업 탭에서 실시간 로그를 봅니다."],
  ["4", "결과 확인", "보고서 탭에서 완료된 job의 report.md를 선택하고 2-1/2-2 섹션을 확인합니다."],
];

const inputSections = [
  ["프리셋", "기본 프리셋을 적용하거나 현재 수동 입력값을 사용자 프리셋으로 저장합니다."],
  ["하드웨어", "array 크기, 주파수, SRAM, dataflow, 에너지/메모리 파라미터를 설정합니다."],
  ["타일링", "tileM, tileN, tileK 후보와 최적화 목표를 설정합니다."],
  ["SCALE-Sim", "bandwidth, SRAM 분할, offset, layout/bank 옵션을 조정합니다."],
  ["워크로드", "CSV, JSON, ONNX 요약에서 GEMM shape를 불러옵니다."],
  ["Conv 변환", "Conv2D 파라미터를 im2col GEMM shape로 변환합니다."],
  ["보정", "측정 cycle CSV를 이용해 estimator 보정 계수를 적용합니다."],
  ["도구/실행", "server estimate, full-pipeline, 환경 진단, 프로젝트 저장/불러오기를 실행합니다."],
];

const reportGuide = [
  ["2-1. 실제 외부 도구 반영 상태", "SCALE-Sim과 IREE 결과가 실제 보고서에 반영되었는지 확인합니다."],
  ["2-2. 예측 결과와 실제 실행 결과 비교", "TileForge estimator cycle과 SCALE-Sim cycle의 차이, 비율, 해석을 확인합니다."],
  ["작업별 보고서 선택", "여러 job을 실행했을 때 원하는 job의 report.md를 골라 봅니다."],
  ["SCALE-Sim/IREE 원본 로그", "외부 도구가 실제로 출력한 stdout/stderr와 실행 명령을 확인합니다."],
];

export default function HelpPage() {
  return (
    <main>
      <header className="topbar">
        <div>
          <h1>TileForge 도움말</h1>
          <p className="lead">
            TileForge를 처음 실행하는 방법부터 full-pipeline 결과를 해석하는 방법까지 한눈에 정리했습니다.
          </p>
        </div>
        <Link className="help-link" href="/">워크벤치로 돌아가기</Link>
      </header>

      <section className="panel doc">
        <h2>빠른 시작</h2>
        <p>
          이미 의존성이 설치되어 있다면 아래 명령만으로 웹 UI와 worker를 함께 실행할 수 있습니다.
        </p>
        <pre className="md-code"><code>{`npm run setup:env
npm run dev`}</code></pre>
        <p>
          완전히 깨끗한 환경에서 다시 시작하려면 다음 명령을 사용합니다.
        </p>
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
        <h2>입력 탭 설명</h2>
        <table>
          <thead><tr><th>탭</th><th>용도</th></tr></thead>
          <tbody>
            {inputSections.map(([name, desc]) => <tr key={name}><td><b>{name}</b></td><td>{desc}</td></tr>)}
          </tbody>
        </table>
      </section>

      <section className="panel doc">
        <h2>작업 큐와 실시간 콘솔</h2>
        <p>
          full-pipeline을 여러 번 실행하면 작업은 큐에 등록되고 worker가 순차적으로 처리합니다. 작업 탭에서는 실행 중인 작업, 대기 중인 작업, 최근 완료/실패 작업을 함께 볼 수 있습니다.
        </p>
        <ul>
          <li><b>실시간 콘솔</b>: TileForge worker의 진행 로그를 CMD처럼 보여줍니다.</li>
          <li><b>원본 외부 도구 로그</b>: SCALE-Sim과 IREE가 출력한 명령, cwd, stdout, stderr를 보여줍니다.</li>
          <li><b>작업 삭제</b>: 더 이상 필요 없는 job과 artifact를 삭제합니다.</li>
          <li><b>작업별 보고서</b>: 완료된 job의 report.md를 선택해서 볼 수 있습니다.</li>
        </ul>
      </section>

      <section className="panel doc">
        <h2>보고서 읽는 법</h2>
        <table>
          <thead><tr><th>확인 위치</th><th>의미</th></tr></thead>
          <tbody>
            {reportGuide.map(([name, desc]) => <tr key={name}><td><b>{name}</b></td><td>{desc}</td></tr>)}
          </tbody>
        </table>
        <p>
          `SCALE-Sim = 적용됨`, `IREE compile = 적용됨`으로 표시되고 VMFB 크기가 0보다 크면 실제 외부 도구 결과가 정상 반영된 것입니다.
        </p>
      </section>

      <section className="panel doc">
        <h2>외부 도구 설정</h2>
        <p>
          TileForge는 최초 실행 시 사용 가능한 SCALE-Sim/IREE 명령을 찾아 `.env`에 저장합니다. 작업 디렉터리가 바뀌어도 안전하도록 module 방식 또는 절대경로 명령을 우선 사용합니다.
        </p>
        <pre className="md-code"><code>{`TILEFORGE_SCALE_SIM_CMD="py -3 -m scalesim.scale"
TILEFORGE_IREE_COMPILE_CMD="py -3 -m iree.compiler.tools.scripts.iree_compile"`}</code></pre>
        <p>
          도구 위치가 바뀌면 `.env`를 수정하거나 `npm run setup:env`를 다시 실행하세요.
        </p>
      </section>

      <section className="panel doc">
        <h2>문제 해결</h2>
        <h3>SCALE-Sim이 실패할 때</h3>
        <p>작업 탭의 “SCALE-Sim / IREE 실행 원본 로그”에서 stderr를 확인하세요. cfg 섹션, topology header, layout 옵션 문제가 대부분 여기 표시됩니다.</p>
        <h3>보고서가 대기 중으로 보일 때</h3>
        <p>보고서 탭에서 완료된 job의 report.md를 선택했는지 확인하세요. Estimator 미리보기 보고서는 외부 도구 상태가 대기 중으로 표시됩니다.</p>
        <h3>IREE VMFB가 0 byte일 때</h3>
        <p><code>TILEFORGE_IREE_COMPILE_CMD</code>가 <code>iree.compiler.tools.core</code>가 아니라 <code>iree.compiler.tools.scripts.iree_compile</code>을 가리키는지 확인하세요.</p>
      </section>
    </main>
  );
}

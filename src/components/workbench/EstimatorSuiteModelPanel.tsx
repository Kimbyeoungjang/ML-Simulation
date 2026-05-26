"use client";

type Props = {
  models: any[];
  active: { runId?: string; model?: any } | null;
  busy: boolean;
  onRefreshModels: () => void;
  onActivateModel: (runId: string) => void;
  onClearActiveModel: () => void;
};

export function EstimatorSuiteModelPanel({
  models,
  active,
  busy,
  onRefreshModels,
  onActivateModel,
  onClearActiveModel,
}: Props) {
  return (
    <section
      className="suite-section"
      title="학습된 Estimator Suite 모델을 일반 TileForge estimator에 적용합니다."
    >
      <h4>1. 활성 Estimator Suite 적용</h4>
      <p className="small">
        활성 모델을 선택하면 일반 타일 ranking, 총 cycle, 보고서의 cycle 값이
        analytical baseline 대신 learned ensemble 보정값을 사용합니다. 서버
        full-pipeline 작업에도 같은 활성 모델이 적용됩니다.
      </p>
      <div className="estimator-actions">
        <button className="secondary" onClick={onRefreshModels} disabled={busy}>
          모델 목록 새로고침
        </button>
        <button
          className="secondary"
          onClick={onClearActiveModel}
          disabled={busy || !active?.runId}
        >
          활성 모델 해제
        </button>
      </div>
      {active?.runId ? (
        <p className="small good">
          현재 활성 모델: <code>{active.runId}</code>
          {active.model?.recommended ? ` (${active.model.recommended})` : ""}
        </p>
      ) : (
        <p className="small warn">
          활성 Estimator Suite 모델이 없습니다. 현재 미리보기는 analytical estimator 기준입니다.
        </p>
      )}
      {Array.isArray(models) && models.length > 0 ? (
        <div className="table-wrap">
          <table className="mini-table">
            <thead>
              <tr>
                <th>상태</th>
                <th>runId</th>
                <th>samples</th>
                <th>추천</th>
                <th>생성 시각</th>
                <th>동작</th>
              </tr>
            </thead>
            <tbody>
              {models.slice(0, 12).map((m: any) => (
                <tr key={m.runId}>
                  <td>{m.runId === active?.runId || m.active ? "활성" : "-"}</td>
                  <td><code>{m.runId}</code></td>
                  <td>{Number(m.samples ?? 0).toLocaleString()}</td>
                  <td>{m.recommended ?? "-"}</td>
                  <td>{m.createdAt ?? "-"}</td>
                  <td>
                    <button
                      className="secondary"
                      onClick={() => onActivateModel(m.runId)}
                      disabled={busy || m.runId === active?.runId}
                    >
                      적용
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="small">
          아직 저장된 estimator-suite-model.json이 없습니다. 학습을 먼저 실행하세요.
        </p>
      )}
    </section>
  );
}

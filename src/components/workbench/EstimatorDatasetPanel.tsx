"use client";

import { useState } from "react";
import type { ChangeEvent } from "react";
import { MiniField } from "./primitives";

export function EstimatorDatasetPanel({
  busy,
  result,
  onImportDataset,
}: {
  busy: boolean;
  result: any | null;
  onImportDataset: (files: Array<{ name: string; text: string }>, train: boolean) => void;
}) {
  const [datasetFiles, setDatasetFiles] = useState<Array<{ name: string; text: string }>>([]);
  const [datasetTrainAfterImport, setDatasetTrainAfterImport] = useState(true);
  const datasetSummary = result?.summary;

  async function onDatasetFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    const loaded = await Promise.all(selected.map(async (file) => ({ name: file.name, text: await file.text() })));
    setDatasetFiles(loaded);
  }

  return (
    <section className="suite-section" title="여러 CSV 파일을 업로드해 하나의 대형 학습 dataset으로 병합하고 바로 학습합니다.">
      <h4>3. 대량 CSV Dataset Manager</h4>
      <p className="small">
        이미 수천~수만 개 SCALE-Sim 결과 CSV가 있다면 여기에 여러 파일을 한 번에 업로드하세요. 자동으로 병합, 중복 제거, measuredCycles/estimatorCycles 유효성 검사, 분포 요약을 수행하고 원하면 바로 Estimator Suite 학습까지 실행합니다.
      </p>
      <div className="row2">
        <MiniField label="CSV 파일 업로드" tip="SCALE-Sim 결과가 포함된 여러 CSV를 선택하면 하나의 학습 dataset으로 병합합니다."><input title="병합할 CSV 파일을 여러 개 선택합니다." type="file" accept=".csv,text/csv" multiple onChange={(e) => void onDatasetFilesSelected(e)} /></MiniField>
        <label className="check" title="켜면 업로드 후 병합 dataset으로 즉시 Tree/Neural/Ensemble 학습까지 실행합니다.">
          <input type="checkbox" checked={datasetTrainAfterImport} onChange={(e) => setDatasetTrainAfterImport(e.target.checked)} /> 업로드 후 즉시 학습
        </label>
      </div>
      {datasetFiles.length > 0 ? (
        <p className="small good">선택된 CSV: {datasetFiles.length.toLocaleString()}개, 총 {(datasetFiles.reduce((sum, f) => sum + f.text.length, 0) / 1024).toFixed(1)} KiB</p>
      ) : (
        <p className="small warn">아직 선택된 CSV가 없습니다. 여러 결과 CSV를 선택한 뒤 아래 버튼을 누르세요.</p>
      )}
      <div className="estimator-actions">
        <button title="선택한 CSV들을 병합하고 유효성 검사 후, 옵션에 따라 즉시 학습합니다." onClick={() => onImportDataset(datasetFiles, datasetTrainAfterImport)} disabled={busy || datasetFiles.length === 0}>{datasetTrainAfterImport ? "CSV 병합 후 자동 학습" : "CSV 병합/검증만 실행"}</button>
        {datasetFiles.length > 0 && <button className="secondary" title="선택한 CSV 파일 목록을 비웁니다." onClick={() => setDatasetFiles([])} disabled={busy}>선택 해제</button>}
      </div>
      {datasetSummary && (
        <div className="table-wrap">
          <table className="mini-table">
            <thead><tr><th>파일</th><th>입력 row</th><th>병합 row</th><th>유효 sample</th><th>중복 제거</th><th>measured 누락</th></tr></thead>
            <tbody>
              <tr>
                <td>{Number(datasetSummary.files ?? 0).toLocaleString()}</td>
                <td>{Number(datasetSummary.inputRows ?? 0).toLocaleString()}</td>
                <td>{Number(datasetSummary.mergedRows ?? 0).toLocaleString()}</td>
                <td>{Number(datasetSummary.validSamples ?? 0).toLocaleString()}</td>
                <td>{Number(datasetSummary.duplicatesRemoved ?? 0).toLocaleString()}</td>
                <td>{Number(datasetSummary.missingMeasuredCycles ?? 0).toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

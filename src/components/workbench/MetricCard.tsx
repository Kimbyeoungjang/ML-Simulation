export function Metric({
  title,
  value,
  tip,
}: {
  title: string;
  value: string;
  tip: string;
}) {
  return (
    <div className="card" title={tip}>
      <span className="small">{title}</span>
      <br />
      <b>{value}</b>
    </div>
  );
}

import ComingSoon from '../components/ComingSoon'

export default function History() {
  return (
    <ComingSoon
      title="History"
      description="Trends over days and weeks."
      module="M6"
      icon="history"
      willInclude={[
        'Score and factor trends for 1 hour up to 30 days',
        'Score-by-hour heatmap',
        'Filterable table of detected deviations',
        'CSV export',
      ]}
    />
  )
}

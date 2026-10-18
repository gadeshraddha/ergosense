import ComingSoon from '../components/ComingSoon'

export default function Sessions() {
  return (
    <ComingSoon
      title="Sessions"
      description="How long you work, and when you take breaks."
      module="M6"
      icon="sessions"
      willInclude={[
        'Live work timer and time since your last break',
        'A one-click break button',
        'Past sessions with average score and breaks',
        'Work vs break time per day',
      ]}
    />
  )
}

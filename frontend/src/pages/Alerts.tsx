import ComingSoon from '../components/ComingSoon'

export default function Alerts() {
  return (
    <ComingSoon
      title="Alerts & Settings"
      description="Voice prompts, alert history and your preferences."
      module="M5"
      icon="bell"
      willInclude={[
        'Timeline of every alert and why it fired',
        'Test voice, mute and snooze controls',
        'Sensitivity, comfort light range and score weights',
        'Profile and danger-zone options',
      ]}
    />
  )
}

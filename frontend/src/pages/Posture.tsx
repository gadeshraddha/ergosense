import ComingSoon from '../components/ComingSoon'

export default function Posture() {
  return (
    <ComingSoon
      title="Posture"
      description="A deep dive into how you sit, compared with your own normal."
      module="M4"
      icon="posture"
      willInclude={[
        'Neck angle, shoulder tilt, head position and distance: current vs your baseline',
        'A live side-profile figure that follows your lean',
        'A drift timeline showing gradual changes over time',
        "Today's time in good, mild and poor posture",
      ]}
    />
  )
}

import ComingSoon from '../components/ComingSoon'

export default function Calibration() {
  return (
    <ComingSoon
      title="Calibration"
      description="Teach ErgoSense what your normal posture looks like."
      module="M3"
      icon="calibrate"
      willInclude={[
        'A guided 2-3 minute wizard',
        'Your personal baseline for neck, shoulders, distance and movement',
        'Redo or recalibrate any time',
      ]}
    />
  )
}

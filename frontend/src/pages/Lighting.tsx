import ComingSoon from '../components/ComingSoon'

export default function Lighting() {
  return (
    <ComingSoon
      title="Lighting"
      description="Room light from the BH1750 sensor, and automatic screen brightness."
      module="M5"
      icon="lighting"
      willInclude={[
        'Live lux reading with a comfort zone',
        'Light-to-brightness curve with a live marker',
        'Auto or manual brightness control',
        'ESP32 and sensor connection status',
      ]}
    />
  )
}

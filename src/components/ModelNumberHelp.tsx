import { useEffect } from 'react';

// Where manufacturers usually put the model/serial label. Placement varies, so
// each entry lists the most common spots first.
const LOCATIONS = [
  {
    appliance: 'Washer',
    spots: [
      'Front-load: around the door opening (the rim you see when the door is open)',
      'Top-load: under the lid, or on the back edge of the top panel',
      'On the back panel, near the water hoses',
    ],
  },
  {
    appliance: 'Dryer',
    spots: ['Around the door opening, on the frame', 'On the inside of the door', 'On the back panel'],
  },
  {
    appliance: 'Dishwasher',
    spots: [
      'On the side edge of the door (open the door and look at its left or right edge)',
      'On the top edge of the door, or on the tub frame',
    ],
  },
];

export default function ModelNumberHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" role="dialog" aria-modal="true" aria-labelledby="model-help-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="model-help-title">Where's my model number?</h2>
        <p className="muted">
          Look for a sticker with <strong>"Model"</strong> or <strong>"M/N"</strong> on it. Take a photo of the whole
          sticker, we'll read it for you.
        </p>
        {LOCATIONS.map((l) => (
          <div key={l.appliance} className="help-group">
            <h3>{l.appliance}</h3>
            <ul>
              {l.spots.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        ))}
        <button className="btn btn-primary" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}

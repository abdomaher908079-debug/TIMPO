import type { Appliance, Diagnosis, DiagnoseRequest } from '../../src/shared/types.js';

// Fixed answers used when no AI key is set, so the whole flow can be tested
// for free. They are clearly labeled as samples in the UI.
const SAMPLES: Record<Appliance, Diagnosis> = {
  Washer: {
    appliance: 'front-load washer',
    brand: 'LG',
    model_number: '',
    error_code: 'OE',
    summary: "Your washer can't drain. The most likely cause is a clogged drain pump filter, which you can clean yourself.",
    confidence: 'medium',
    likely_causes: [
      { cause: 'Clogged drain pump filter', likelihood: 'high', explanation: 'Coins, lint or hair block the filter so water can’t leave the drum.' },
      { cause: 'Kinked or blocked drain hose', likelihood: 'medium', explanation: 'A bent or blocked hose behind the washer stops the water flowing out.' },
      { cause: 'Faulty drain pump', likelihood: 'low', explanation: 'The pump motor that pushes water out may have stopped working.' },
    ],
    difficulty: 'easy',
    safety_warnings: ['Unplug the washer and turn off the water taps before you start.', 'Put towels down: water will come out when you open the filter.'],
    steps: [
      'Unplug the washer and turn off both water taps.',
      'Open the small panel at the bottom front of the washer.',
      'Pull out the small drain hose, remove its cap and let the water drain into a shallow tray.',
      'Turn the drain pump filter counter-clockwise, pull it out and clean it.',
      'Put the filter back firmly, close the panel and run a Rinse + Spin cycle to test.',
    ],
    parts: [
      { name: 'Drain pump', plain_name: 'the small motor that pushes water out of the washer', search_query: 'LG washer drain pump', why: 'Only needed if the washer still won’t drain after cleaning the filter and checking the hose.' },
    ],
    call_a_pro_if: ['The washer still won’t drain after cleaning the filter and checking the hose, and you’re not comfortable replacing the pump.'],
    need_more_info: 'A photo of the model label (inside the door rim) would let us find the exact drain pump for your washer.',
  },
  Dryer: {
    appliance: 'electric vented dryer',
    brand: '',
    model_number: '',
    error_code: '',
    summary: "Your dryer runs but doesn't heat. The most common cause is a blown thermal fuse, often because the vent is clogged with lint.",
    confidence: 'low',
    likely_causes: [
      { cause: 'Blown thermal fuse', likelihood: 'high', explanation: 'A small safety part that cuts the heat when the dryer overheats, usually because of a clogged vent.' },
      { cause: 'Burned-out heating element', likelihood: 'medium', explanation: 'The coil that makes the heat can break after years of use.' },
      { cause: 'Clogged exhaust vent', likelihood: 'medium', explanation: 'Lint in the vent pipe traps hot air and makes the dryer overheat.' },
    ],
    difficulty: 'moderate',
    safety_warnings: ['Unplug the dryer before opening any panel.', 'Never bypass the thermal fuse: it prevents fires. Find out why it blew before replacing it.'],
    steps: [
      'Clean the lint screen and check the vent hose behind the dryer for lint or crushing.',
      'Go outside and check the vent flap opens when the dryer runs.',
      'If it still doesn’t heat, unplug the dryer and test the thermal fuse with a multimeter (it should show continuity).',
      'Replace the thermal fuse if it has no continuity, and clean the whole vent before using the dryer again.',
    ],
    parts: [
      { name: 'Thermal fuse', plain_name: 'a small safety part that cuts the heat when the dryer gets too hot', search_query: 'dryer thermal fuse', why: 'The most common reason a dryer stops heating.' },
      { name: 'Heating element', plain_name: 'the coil that heats the air', search_query: 'dryer heating element', why: 'Needed if the fuse is fine but there’s still no heat.' },
    ],
    call_a_pro_if: ['Your dryer runs on gas: gas dryers need a licensed technician.', 'The new fuse blows again soon after replacing it.'],
    need_more_info: 'A photo of the model label (around the door opening) would let us find the exact parts for your dryer.',
  },
  Dishwasher: {
    appliance: 'built-in dishwasher',
    brand: 'Bosch',
    model_number: '',
    error_code: 'E24',
    summary: 'Your dishwasher can’t drain properly. Usually the filter at the bottom or the drain hose is blocked.',
    confidence: 'medium',
    likely_causes: [
      { cause: 'Clogged filter', likelihood: 'high', explanation: 'Food scraps block the filter at the bottom of the tub.' },
      { cause: 'Kinked drain hose', likelihood: 'medium', explanation: 'The hose under the sink is bent so water can’t flow out.' },
      { cause: 'Blocked drain pump', likelihood: 'low', explanation: 'Something small, like glass or a seed, is stuck in the pump.' },
    ],
    difficulty: 'easy',
    safety_warnings: ['Turn the dishwasher off and unplug it before reaching into the drain area.', 'Watch for broken glass in the filter.'],
    steps: [
      'Turn off and unplug the dishwasher.',
      'Remove the bottom rack, twist out the filter and rinse it under running water.',
      'Scoop out any standing water and check under the filter for debris.',
      'Check the drain hose under the sink isn’t kinked; if connected to a garbage disposal, run the disposal.',
      'Refit the filter until it locks and run a short program to test.',
    ],
    parts: [],
    call_a_pro_if: ['The code comes back after cleaning the filter and checking the hose.'],
    need_more_info: '',
  },
};

export function sampleDiagnosis(req: DiagnoseRequest): Diagnosis {
  return SAMPLES[req.appliance];
}

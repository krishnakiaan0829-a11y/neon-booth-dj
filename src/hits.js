// Viral house hits, picked by hand and checked against Spotify search on 2026-11-24.
// Spotify no longer gives apps a popularity number, so this list is curated, not computed.
const IDS = [
  '6YXJV9sW9nD3cAaRQAtBDs', // Ferrari - James Hype & Miggy Dela Rosa
  '6TWbY1dq8eYtFiMiGdBlOa', // Free Your Mind - Prospa, Cloonee, Sybil
  '4qDpLaFGf5ampf2DXD2TMA', // Where You Are - John Summit & HAYLA
  '32VIrOsJmwvqRm4rWFBCsi', // Shiver - John Summit & HAYLA
  '68lTEhMEx4MxDCJypT6bXE', // Escape (John Summit Remix) - Kx5 & HAYLA
  '787Y2idwCU2Rk60Prv4wpr', // Saving Up - Dom Dolla
  '5mKiwDDrwG22qKKVL6JZqF', // Rhyme Dust - MK & Dom Dolla
  '6ho0GyrWZN3mhi9zVRW7xi', // Losing It - FISHER
  '0aL5jEWqfIwNDB3tdzyzH4', // Cola - CamelPhat & Elderbrook
  '5eTaQYBE1yrActixMAeLcZ', // Miracle - Calvin Harris & Ellie Goulding
  '7dx2BcBcf0OzegEX7AvkGg', // Lose Control - MEDUZA, Becky Hill, Goodboys
  '4tcPIwy0UvLYjhXLrMyx89', // Pump It Up - Endor
  '2ZWmmrWUgDBcPSLihBMvhg', // Baddadan - Chase & Status
  '59NraMJsLaMCVtwXTSia8i', // Prada - cassö, RAYE, D-Block Europe
  '40SBS57su9xLiE1WqkXOVr', // Afraid To Feel - LF SYSTEM
  '39JofJHEtg8I4fSyo7Imft', // B.O.T.A. - Eliza Rose & Interplanetary Criminal
  '22dUzMFttcR3uU17NcOAIv', // Desire - Calvin Harris & Sam Smith
  '1GfBLbAhZUWdseuDqhocmn', // Rumble - Skrillex, Fred again.., Flowdan
  '1Xwmm4J0BYmSRush63By5y', // Jungle - Fred again..
  '3Vp3N70WX6bKdZpIFwj1ga', // Hot In It - Tiësto & Charli XCX
];

export const HITS = { name: 'Viral House Hits', hits: true, uris: IDS.map(id => 'spotify:track:' + id) };

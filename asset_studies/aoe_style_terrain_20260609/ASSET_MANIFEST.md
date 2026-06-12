# AoE-Style Terrain Asset Study

Generated: 2026-06-09
Purpose: Research-only terrain art assets for a hybrid Canvas 2D terrain pipeline. These files are not wired into the current game.

## Files

- `01_base_terrain/base_terrain_sheet.png`
  - Base isometric ground variants: bright grass, dark forest grass, dry grass, dirt, road, gravel, and farm field.
- `02_doodads/doodads_sheet.png`
  - Small scatter details: pebbles, grass tufts, flowers, shrubs, twigs, leaf litter, cracks, mud marks, and mossy stones.
- `03_vegetation/vegetation_sheet.png`
  - Y-sorted vegetation candidates: bamboo clusters, broadleaf trees, shrub clusters, undergrowth, and shadow shapes.
- `04_rocks_cliffs/rocks_cliffs_sheet.png`
  - Rock and fake-elevation candidates: boulder clusters, rock piles, karst-like stones, cliff faces, slope pieces, and mossy rock details.
- `05_village_farm/village_farm_sheet.png`
  - Village and farm prefabs: thatched houses, huts, fences, carts, props, well, farm plots, and yard decals.
- `06_transitions/transitions_sheet.png`
  - Organic transition overlays: grass/dirt, grass/forest, dirt/road, dirt/farm, and grass/gravel edge candidates.

## Notes

- The sheets are exploratory generated bitmap assets. They should be reviewed, cut into individual sprites, cleaned up, and possibly regenerated in smaller focused batches before production use.
- The current game assets and renderer have not been modified to reference these files.
- Best next step: split one sheet at a time into candidate sprites, then build a contact-sheet review page with scale tests at current tile sizes.

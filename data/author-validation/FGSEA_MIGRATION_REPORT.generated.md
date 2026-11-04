# FGSEA cache-isolation migration audit

160 datasets, 174 registered contrasts, and 696 contrast/collection comparisons are rebuilt and schema-3 provenance checked. The macaque single-cell dataset is excluded.

Baseline: Git commit `25cb4827a7385181e3fd09713be39ebda80ca13c` (pre-audit local FGSEA, **not** author pathway results).

GSE281503: Pre-migration local snapshot: the original processed files dated 2026-08-31 are in a Git-ignored dataset directory and have no committed baseline. These copies were captured before the cache-isolated FGSEA rebuild; they are local pipeline outputs, not author-generated pathway results. Captured 2026-09-02T12:44:29-04:00; file sizes and SHA-256 values are pinned in `fgsea-baselines/manifest.json`.

GSE317867: Initial post-migration reference for a September 5 intake study, computed with the corrected schema-3 workflow. This study was added after the migration and has no pre-migration result. The reference preserves initial pipeline outputs; it is not author validation or evidence of a migration improvement. Captured 2026-09-05T23:10:01.278032+00:00; file sizes and SHA-256 values are pinned in `fgsea-baselines/manifest.json`.

GSE278158: Initial post-migration reference for a September 5 intake study, computed with the corrected schema-3 workflow. This study was added after the migration and has no pre-migration result. The reference preserves initial pipeline outputs; it is not author validation or evidence of a migration improvement. Captured 2026-09-05T23:10:01.294512+00:00; file sizes and SHA-256 values are pinned in `fgsea-baselines/manifest.json`.

GSE309435: Initial post-migration reference for a September 5 intake study, computed with the corrected schema-3 workflow. This study was added after the migration and has no pre-migration result. The reference preserves initial pipeline outputs; it is not author validation or evidence of a migration improvement. Captured 2026-09-05T23:10:01.308310+00:00; file sizes and SHA-256 values are pinned in `fgsea-baselines/manifest.json`.

GSE148252: Initial post-migration reference for a September 5 intake study, computed with the corrected schema-3 workflow. This study was added after the migration and has no pre-migration result. The reference preserves initial pipeline outputs; it is not author validation or evidence of a migration improvement. Captured 2026-09-05T23:10:01.362006+00:00; file sizes and SHA-256 values are pinned in `fgsea-baselines/manifest.json`.

E-MTAB-15488: Initial post-migration reference for a September 5 intake study, computed with the corrected schema-3 workflow. This study was added after the migration and has no pre-migration result. The reference preserves initial pipeline outputs; it is not author validation or evidence of a migration improvement. Captured 2026-09-05T23:10:01.392819+00:00; file sizes and SHA-256 values are pinned in `fgsea-baselines/manifest.json`.

E-MTAB-15489: Initial post-migration reference for a September 5 intake study, computed with the corrected schema-3 workflow. This study was added after the migration and has no pre-migration result. The reference preserves initial pipeline outputs; it is not author validation or evidence of a migration improvement. Captured 2026-09-05T23:10:01.407848+00:00; file sizes and SHA-256 values are pinned in `fgsea-baselines/manifest.json`.

GSE337822: Initial post-migration reference for a September 5 intake study, computed with the corrected schema-3 workflow. This study was added after the migration and has no pre-migration result. The reference preserves initial pipeline outputs; it is not author validation or evidence of a migration improvement. Captured 2026-09-05T23:10:01.423098+00:00; file sizes and SHA-256 values are pinned in `fgsea-baselines/manifest.json`.

GSE262407: Initial post-migration reference for a September 5 intake study, computed with the corrected schema-3 workflow. This study was added after the migration and has no pre-migration result. The reference preserves initial pipeline outputs; it is not author validation or evidence of a migration improvement. Captured 2026-09-05T23:10:01.476684+00:00; file sizes and SHA-256 values are pinned in `fgsea-baselines/manifest.json`.

GSE314184: Initial post-migration reference for a September 5 intake study, computed with the corrected schema-3 workflow. This study was added after the migration and has no pre-migration result. The reference preserves initial pipeline outputs; it is not author validation or evidence of a migration improvement. Captured 2026-09-05T23:10:01.539375+00:00; file sizes and SHA-256 values are pinned in `fgsea-baselines/manifest.json`.

GSE113576: Initial post-migration reference for a September 5 intake study, computed with the corrected schema-3 workflow. This study was added after the migration and has no pre-migration result. The reference preserves initial pipeline outputs; it is not author validation or evidence of a migration improvement. Captured 2026-09-05T23:10:01.559526+00:00; file sizes and SHA-256 values are pinned in `fgsea-baselines/manifest.json`.

GSE135007: Initial post-migration reference for a September 5 intake study, computed with the corrected schema-3 workflow. This study was added after the migration and has no pre-migration result. The reference preserves initial pipeline outputs; it is not author validation or evidence of a migration improvement. Captured 2026-09-05T23:10:01.570208+00:00; file sizes and SHA-256 values are pinned in `fgsea-baselines/manifest.json`.

GSE224274: Initial post-migration reference for a September 5 intake study, computed with the corrected schema-3 workflow. This study was added after the migration and has no pre-migration result. The reference preserves initial pipeline outputs; it is not author validation or evidence of a migration improvement. Captured 2026-09-05T23:10:01.580960+00:00; file sizes and SHA-256 values are pinned in `fgsea-baselines/manifest.json`.

GSE308884: Initial post-migration reference for a September 5 intake study, computed with the corrected schema-3 workflow. This study was added after the migration and has no pre-migration result. The reference preserves initial pipeline outputs; it is not author validation or evidence of a migration improvement. Captured 2026-09-05T23:10:01.612992+00:00; file sizes and SHA-256 values are pinned in `fgsea-baselines/manifest.json`.

GSE281701: Initial post-migration reference for a September 5 intake study, computed with the corrected schema-3 workflow. This study was added after the migration and has no pre-migration result. The reference preserves initial pipeline outputs; it is not author validation or evidence of a migration improvement. Captured 2026-09-05T23:10:01.631681+00:00; file sizes and SHA-256 values are pinned in `fgsea-baselines/manifest.json`.

GSE104709: Initial post-migration reference for a new HFD intake study. No pre-migration output exists. These immutable first-release pipeline outputs are not author validation or evidence of migration improvement. Default-track scope; the HFD intake audit covers every track. Captured 2026-09-12; file sizes and SHA-256 values are pinned in `fgsea-baselines/manifest.json`.

GSE107324: Initial post-migration reference for a new HFD intake study. No pre-migration output exists. These immutable first-release pipeline outputs are not author validation or evidence of migration improvement. Default-track scope; the HFD intake audit covers every track. Captured 2026-09-12; file sizes and SHA-256 values are pinned in `fgsea-baselines/manifest.json`.

The msigdbr target-species ortholog cache was reused across collections. Clearing it for every collection prevents later GO/KEGG/Reactome mappings from being restricted to earlier gene sets. All outputs now use explicit HS authority and reset the FGSEA seed before each collection. Therefore both corrected membership and deterministic seed policy can change results.

157 contrasts also have DE-table contents changed by this audit (compared after line-ending normalization); their pathway differences can additionally reflect the corrected inputs. The JSON/TSV marks these contrasts, so not every delta is attributed to the cache repair alone.

Across contrast/collection rows: 769,676 → 845,752 rows; 102,213 added, 26,137 removed; 42,184 shared-row NES direction changes. At FDR < 0.05: 12,526 calls gained and 9,214 lost. These are row counts across collections and contrasts, not unique biological pathways.

Numerical limitations: 209 → 209 rows lack a finite probability or NES. Current missing rows occur in 27 contrast/collection files across 14 datasets. Rows with missing or nonfinite pval, padj, or NES are omitted from public pathway tables; they are never converted to zero. The resulting public tables contain 845,543 finite rows.


The initial all-set migration reported 23 warnings, but their exact messages were not retained. The saved missing-value and probability-floor patterns are consistent with the installed fgsea imbalance and eps warnings, not proof of each original warning. Full collection TSVs omit log2err, so other non-focal precision warnings cannot be assessed retrospectively.

| Dataset | Contrasts | Before / after rows | Added / removed | NES direction changes | FDR calls gained / lost |
| --- | ---: | ---: | ---: | ---: | ---: |
| GSE220533 | 1 | 3564 / 5440 | 2089 / 213 | 448 | 347 / 355 |
| GSE225038 | 1 | 3385 / 5147 | 1957 / 195 | 604 | 388 / 148 |
| GSE284408 | 1 | 3227 / 4907 | 1850 / 170 | 490 | 19 / 82 |
| GSE235479 | 1 | 3378 / 5130 | 1945 / 193 | 445 | 96 / 89 |
| E-MTAB-6929 | 1 | 3353 / 5065 | 1900 / 188 | 456 | 365 / 184 |
| GSE167264 | 1 | 3252 / 4931 | 1851 / 172 | 655 | 23 / 0 |
| GSE314029 | 1 | 3383 / 5131 | 1944 / 196 | 705 | 84 / 10 |
| GSE294478 | 1 | 3309 / 5044 | 1922 / 187 | 290 | 422 / 296 |
| GSE247825 | 1 | 3368 / 5088 | 1911 / 191 | 582 | 213 / 99 |
| GSE305719 | 1 | 3283 / 4982 | 1876 / 177 | 487 | 31 / 105 |
| GSE236077 | 1 | 3312 / 5038 | 1911 / 185 | 344 | 530 / 149 |
| GSE214683 | 1 | 3084 / 4689 | 1764 / 159 | 590 | 12 / 10 |
| GSE292416 | 1 | 3198 / 4863 | 1834 / 169 | 548 | 41 / 1 |
| GSE198437 | 1 | 3350 / 5063 | 1904 / 191 | 498 | 39 / 8 |
| GSE282067 | 1 | 1918 / 2918 | 1032 / 32 | 399 | 5 / 0 |
| GSE329539 | 1 | 3314 / 5017 | 1884 / 181 | 496 | 369 / 125 |
| GSE68177 | 1 | 2913 / 4504 | 1749 / 158 | 246 | 86 / 194 |
| GSE162673 | 1 | 3325 / 5019 | 1876 / 182 | 615 | 8 / 37 |
| GSE148641 | 1 | 3212 / 4835 | 1793 / 170 | 627 | 77 / 11 |
| GSE123983 | 1 | 3325 / 5047 | 1908 / 186 | 398 | 273 / 58 |
| GSE285006 | 1 | 3385 / 5093 | 1901 / 193 | 722 | 0 / 0 |
| GSE328990 | 1 | 3356 / 5094 | 1928 / 190 | 512 | 0 / 0 |
| GSE162744 | 1 | 3312 / 5011 | 1882 / 183 | 575 | 0 / 1 |
| GSE135639 | 4 | 13096 / 19668 | 7264 / 692 | 1826 | 1697 / 506 |
| GSE305688 | 1 | 3353 / 5067 | 1901 / 187 | 586 | 44 / 0 |
| GSE252364 | 1 | 3180 / 4806 | 1795 / 169 | 543 | 50 / 28 |
| GSE157077 | 1 | 4803 / 4833 | 193 / 163 | 108 | 92 / 131 |
| GSE248462 | 1 | 3303 / 5023 | 1900 / 180 | 555 | 124 / 84 |
| GSE185074 | 1 | 3386 / 5098 | 1902 / 190 | 354 | 578 / 152 |
| GSE160802 | 1 | 3193 / 4835 | 1813 / 171 | 635 | 20 / 4 |
| GSE132352 | 1 | 3128 / 4733 | 1772 / 167 | 603 | 102 / 10 |
| GSE280382 | 1 | 3351 / 5095 | 1935 / 191 | 678 | 203 / 13 |
| GSE246918 | 1 | 3375 / 5082 | 1897 / 190 | 580 | 496 / 64 |
| GSE158751 | 1 | 3312 / 5020 | 1887 / 179 | 620 | 178 / 109 |
| GSE210311 | 1 | 3258 / 4966 | 1882 / 174 | 482 | 300 / 71 |
| GSE190712 | 1 | 2560 / 3980 | 1532 / 112 | 324 | 1 / 20 |
| GSE162563 | 1 | 3287 / 4918 | 1799 / 168 | 412 | 138 / 34 |
| GSE295250 | 1 | 3248 / 4931 | 1857 / 174 | 580 | 58 / 1 |
| GSE153551 | 1 | 3248 / 4919 | 1841 / 170 | 262 | 40 / 169 |
| GSE329555 | 1 | 3310 / 5026 | 1901 / 185 | 500 | 364 / 122 |
| GSE285906 | 1 | 3345 / 5073 | 1918 / 190 | 369 | 101 / 300 |
| GSE68177 | 1 | 2849 / 4470 | 1776 / 155 | 461 | 121 / 17 |
| GSE181204 | 1 | 4912 / 4949 | 191 / 154 | 158 | 0 / 0 |
| GSE205313 | 1 | 5101 / 5124 | 196 / 173 | 151 | 60 / 69 |
| GSE212299 | 1 | 4534 / 4554 | 181 / 161 | 239 | 17 / 1 |
| GSE217420 | 1 | 5139 / 5160 | 197 / 176 | 251 | 75 / 53 |
| GSE224780 | 1 | 4618 / 4635 | 180 / 163 | 170 | 1 / 0 |
| GSE229838 | 1 | 4998 / 5019 | 187 / 166 | 48 | 77 / 42 |
| GSE234483 | 1 | 4992 / 5019 | 206 / 179 | 183 | 133 / 138 |
| GSE240484 | 1 | 4831 / 4866 | 191 / 156 | 121 | 27 / 24 |
| GSE242187 | 1 | 4963 / 4984 | 189 / 168 | 162 | 83 / 70 |
| GSE242245 | 1 | 4840 / 4863 | 185 / 162 | 142 | 3 / 6 |
| GSE245727 | 1 | 5015 / 5033 | 198 / 180 | 131 | 45 / 37 |
| GSE252779 | 1 | 5264 / 4841 | 186 / 609 | 1673 | 110 / 321 |
| GSE235792 | 1 | 5047 / 5061 | 195 / 181 | 234 | 0 / 13 |
| GSE254155 | 1 | 4925 / 4962 | 198 / 161 | 126 | 11 / 28 |
| GSE289833 | 1 | 5005 / 5022 | 196 / 179 | 204 | 6 / 23 |
| GSE227689 | 1 | 4842 / 4873 | 192 / 161 | 168 | 14 / 28 |
| GSE240365 | 1 | 5001 / 5020 | 193 / 174 | 146 | 13 / 30 |
| GSE314817 | 1 | 4994 / 5020 | 194 / 168 | 80 | 29 / 91 |
| GSE201207 | 1 | 5201 / 5214 | 198 / 185 | 113 | 209 / 51 |
| GSE212336 | 1 | 4786 / 4812 | 190 / 164 | 148 | 24 / 174 |
| GSE99791 | 1 | 4886 / 4924 | 195 / 157 | 171 | 34 / 47 |
| GSE270383 | 1 | 4332 / 4359 | 172 / 145 | 164 | 40 / 23 |
| GSE273038 | 1 | 4698 / 4713 | 178 / 163 | 167 | 14 / 0 |
| GSE212491 | 1 | 4880 / 4908 | 183 / 155 | 196 | 6 / 7 |
| GSE143818 | 1 | 3173 / 3097 | 132 / 208 | 386 | 13 / 4 |
| GSE130597 | 1 | 4476 / 4501 | 173 / 148 | 73 | 35 / 142 |
| GSE174085 | 1 | 5172 / 5190 | 197 / 179 | 642 | 164 / 15 |
| GSE289461 | 1 | 4949 / 4988 | 203 / 164 | 135 | 41 / 46 |
| GSE87544 | 1 | 4865 / 4858 | 179 / 186 | 491 | 27 / 7 |
| GSE232510 | 1 | 4372 / 4341 | 161 / 192 | 214 | 18 / 14 |
| GSE229440 | 1 | 5117 / 5125 | 195 / 187 | 179 | 49 / 115 |
| GSE280030 | 1 | 4216 / 4218 | 160 / 158 | 64 | 82 / 54 |
| GSE168151 | 1 | 4802 / 4761 | 186 / 227 | 173 | 9 / 36 |
| GSE175461 | 1 | 4899 / 4857 | 191 / 233 | 159 | 3 / 9 |
| GSE145431 | 1 | 4859 / 4825 | 188 / 222 | 259 | 15 / 6 |
| GSE225359 | 1 | 4822 / 4788 | 187 / 221 | 223 | 36 / 46 |
| GSE169296 | 1 | 4665 / 4609 | 169 / 225 | 230 | 11 / 1 |
| GSE242354 | 1 | 5259 / 5270 | 195 / 184 | 239 | 1 / 3 |
| GSE124693 | 1 | 5200 / 5211 | 188 / 177 | 175 | 67 / 18 |
| GSE96627 | 1 | 5452 / 5460 | 204 / 196 | 213 | 29 / 50 |
| GSE174753 | 1 | 5194 / 5203 | 191 / 182 | 142 | 1 / 0 |
| GSE133293 | 1 | 5227 / 5233 | 192 / 186 | 188 | 15 / 12 |
| GSE160467 | 1 | 3208 / 3234 | 131 / 105 | 107 | 0 / 1 |
| GSE270378 | 1 | 4243 / 4250 | 164 / 157 | 141 | 1 / 12 |
| GSE275887 | 1 | 4294 / 4310 | 163 / 147 | 170 | 2 / 28 |
| GSE229799 | 1 | 4910 / 4943 | 203 / 170 | 158 | 31 / 11 |
| GSE296488 | 1 | 5405 / 5417 | 201 / 189 | 150 | 131 / 76 |
| GSE281503 (local snapshot) | 1 | 4988 / 5008 | 194 / 174 | 69 | 13 / 5 |
| GSE261833 | 1 | 5212 / 5169 | 203 / 246 | 256 | 76 / 418 |
| GSE128537 | 1 | 4713 / 4724 | 174 / 163 | 155 | 5 / 2 |
| GSE102415 | 1 | 5053 / 5076 | 199 / 176 | 183 | 37 / 53 |
| GSE253875 | 1 | 4601 / 4618 | 181 / 164 | 136 | 100 / 104 |
| GSE243287 | 1 | 5450 / 5458 | 199 / 191 | 191 | 161 / 93 |
| GSE218188 | 1 | 5401 / 5409 | 198 / 190 | 175 | 63 / 48 |
| GSE56238 | 1 | 4976 / 5004 | 190 / 162 | 121 | 74 / 62 |
| GSE100349 | 1 | 3678 / 3692 | 136 / 122 | 174 | 0 / 9 |
| GSE314970 | 1 | 5073 / 5092 | 199 / 180 | 125 | 77 / 52 |
| GSE306829 | 1 | 5092 / 5104 | 192 / 180 | 130 | 54 / 123 |
| GSE102471 | 1 | 4820 / 4795 | 193 / 218 | 251 | 13 / 30 |
| GSE330152 | 1 | 5388 / 5320 | 205 / 273 | 327 | 65 / 286 |
| GSE95243 | 1 | 5106 / 5120 | 191 / 177 | 299 | 69 / 46 |
| GSE98519 | 1 | 4991 / 5023 | 199 / 167 | 273 | 7 / 7 |
| GSE98690 | 1 | 4489 / 4513 | 193 / 169 | 140 | 21 / 15 |
| GSE99690 | 1 | 4545 / 4564 | 176 / 157 | 62 | 10 / 67 |
| GSE132308 | 1 | 4688 / 4708 | 188 / 168 | 198 | 18 / 7 |
| GSE214877 | 1 | 4974 / 4995 | 192 / 171 | 145 | 42 / 10 |
| GSE229159 | 1 | 4763 / 4721 | 182 / 224 | 346 | 21 / 11 |
| GSE264350 | 1 | 5427 / 5438 | 199 / 188 | 193 | 16 / 32 |
| GSE298648 | 1 | 4385 / 4399 | 175 / 161 | 203 | 3 / 0 |
| GSE131172 | 1 | 5424 / 5435 | 205 / 194 | 185 | 58 / 69 |
| E-MTAB-12340 | 1 | 4228 / 4253 | 177 / 152 | 104 | 22 / 16 |
| GSE128148 | 1 | 4371 / 4389 | 172 / 154 | 266 | 3 / 0 |
| GSE156859 | 1 | 4465 / 4487 | 175 / 153 | 118 | 51 / 39 |
| GSE167105 | 1 | 5313 / 5329 | 197 / 181 | 179 | 42 / 34 |
| GSE189945 | 1 | 5067 / 5101 | 203 / 169 | 158 | 86 / 82 |
| GSE190389 | 1 | 5151 / 5172 | 197 / 176 | 191 | 20 / 7 |
| GSE204883 | 1 | 4836 / 4871 | 193 / 158 | 159 | 0 / 0 |
| GSE179663 | 1 | 5063 / 5080 | 196 / 179 | 190 | 28 / 8 |
| GSE104255 | 1 | 4133 / 4144 | 160 / 149 | 157 | 95 / 90 |
| GSE141144 | 1 | 4614 / 4632 | 186 / 168 | 76 | 45 / 112 |
| GSE202003 | 1 | 4319 / 4338 | 170 / 151 | 159 | 3 / 18 |
| GSE227725 | 1 | 5104 / 5119 | 194 / 179 | 100 | 129 / 103 |
| GSE201408 | 1 | 5007 / 5033 | 198 / 172 | 114 | 0 / 4 |
| GSE274003 | 1 | 3231 / 3258 | 134 / 107 | 115 | 0 / 0 |
| GSE207494 | 1 | 5011 / 5031 | 197 / 177 | 129 | 41 / 112 |
| GSE207992 | 1 | 5107 / 5134 | 197 / 170 | 193 | 104 / 57 |
| GSE208722 | 1 | 5006 / 5028 | 193 / 171 | 208 | 19 / 0 |
| GSE243697 | 1 | 3456 / 5233 | 1976 / 199 | 400 | 97 / 43 |
| GSE128660 | 1 | 5422 / 5436 | 206 / 192 | 154 | 53 / 183 |
| GSE245146 | 1 | 5244 / 5246 | 191 / 189 | 99 | 20 / 172 |
| GSE266472 | 1 | 5093 / 5103 | 188 / 178 | 137 | 28 / 20 |
| GSE278826 | 1 | 4362 / 4371 | 176 / 167 | 191 | 4 / 27 |
| GSE281726 | 1 | 4032 / 4054 | 165 / 143 | 157 | 4 / 1 |
| GSE299412 | 1 | 2833 / 2850 | 127 / 110 | 80 | 27 / 2 |
| GSE231617 | 1 | 5367 / 5389 | 201 / 179 | 113 | 216 / 117 |
| GSE231769 | 1 | 4856 / 4899 | 193 / 150 | 164 | 60 / 30 |
| GSE224254 | 1 | 4916 / 4946 | 194 / 164 | 131 | 32 / 38 |
| GSE153495 | 1 | 5316 / 5347 | 202 / 171 | 235 | 25 / 4 |
| GSE153498 | 1 | 5305 / 5332 | 202 / 175 | 195 | 57 / 230 |
| GSE301692 | 1 | 4992 / 5012 | 195 / 175 | 182 | 62 / 66 |
| GSE324226 | 1 | 4961 / 5000 | 200 / 161 | 118 | 43 / 43 |
| GSE49540 | 1 | 4640 / 4663 | 178 / 155 | 220 | 5 / 3 |
| GSE317867 (local snapshot) | 1 | 4946 / 4946 | 0 / 0 | 0 | 3 / 92 |
| GSE278158 (local snapshot) | 1 | 5131 / 5131 | 0 / 0 | 0 | 0 / 0 |
| GSE309435 (local snapshot) | 1 | 5054 / 4974 | 17 / 97 | 174 | 6 / 0 |
| GSE148252 (local snapshot) | 4 | 19917 / 19917 | 0 / 0 | 0 | 0 / 0 |
| E-MTAB-15488 (local snapshot) | 2 | 10211 / 10211 | 0 / 0 | 5 | 33 / 25 |
| E-MTAB-15489 (local snapshot) | 1 | 5072 / 5072 | 0 / 0 | 1 | 71 / 18 |
| GSE337822 (local snapshot) | 1 | 4643 / 4643 | 0 / 0 | 0 | 0 / 0 |
| GSE262407 (local snapshot) | 4 | 19912 / 19912 | 0 / 0 | 0 | 0 / 0 |
| GSE314184 (local snapshot) | 4 | 19975 / 19975 | 0 / 0 | 0 | 0 / 0 |
| GSE113576 (local snapshot) | 1 | 4969 / 4969 | 0 / 0 | 0 | 0 / 0 |
| GSE135007 (local snapshot) | 1 | 5073 / 5073 | 0 / 0 | 2 | 0 / 8 |
| GSE224274 (local snapshot) | 1 | 1331 / 1331 | 0 / 0 | 0 | 0 / 0 |
| GSE308884 (local snapshot) | 2 | 10905 / 10905 | 0 / 0 | 6 | 33 / 45 |
| GSE281701 (local snapshot) | 1 | 5066 / 5066 | 0 / 0 | 0 | 0 / 33 |
| GSE104709 (local snapshot) | 1 | 5178 / 5178 | 0 / 0 | 0 | 0 / 0 |
| GSE107324 (local snapshot) | 1 | 4561 / 4561 | 0 / 0 | 0 | 9 / 4 |

## Untestable current pathway rows

| Dataset | Contrast | Collection | Missing rows |
| --- | --- | --- | ---: |
| GSE314029 | agonist_vs_vehicle | GO_BP | 7 |
| GSE314029 | agonist_vs_vehicle | REACTOME | 1 |
| GSE153551 | fgf1_vs_vehicle | GO_BP | 3 |
| GSE229838 | pel_vs_sham | GO_BP | 25 |
| GSE229838 | pel_vs_sham | HALLMARK | 3 |
| GSE229838 | pel_vs_sham | KEGG | 1 |
| GSE229838 | pel_vs_sham | REACTOME | 14 |
| GSE314817 | aged_vs_young | GO_BP | 8 |
| GSE314817 | aged_vs_young | REACTOME | 3 |
| GSE175461 | dehydrated_vs_euhydrated | GO_BP | 3 |
| GSE296488 | cagrilintide_vs_vehicle | GO_BP | 4 |
| GSE296488 | cagrilintide_vs_vehicle | REACTOME | 1 |
| GSE281503 | lps_vs_saline_vehicle | GO_BP | 8 |
| GSE281503 | lps_vs_saline_vehicle | REACTOME | 5 |
| GSE306829 | pnoc_ip_vs_input | GO_BP | 8 |
| GSE306829 | pnoc_ip_vs_input | REACTOME | 6 |
| GSE99690 | orexin_a_3h_vs_vehicle_paired | GO_BP | 3 |
| GSE99690 | orexin_a_3h_vs_vehicle_paired | REACTOME | 2 |
| GSE141144 | fluoxetine_lineage_vs_vehicle_unstressed_adult | GO_BP | 37 |
| GSE141144 | fluoxetine_lineage_vs_vehicle_unstressed_adult | HALLMARK | 4 |
| GSE141144 | fluoxetine_lineage_vs_vehicle_unstressed_adult | KEGG | 2 |
| GSE141144 | fluoxetine_lineage_vs_vehicle_unstressed_adult | REACTOME | 38 |
| GSE243697 | plx3397_vs_vehicle_sex_adjusted | GO_BP | 5 |
| GSE245146 | maternal_prrsv_vs_control_saline_sex_adjusted | REACTOME | 1 |
| GSE324226 | low_vs_high_growth_day39 | GO_BP | 14 |
| GSE324226 | low_vs_high_growth_day39 | REACTOME | 2 |
| GSE148252 | light_vs_dark_wt | REACTOME | 1 |

Per-collection metrics and hashes are in `fgsea-migration.generated.tsv`. The JSON includes exact added/removed pathway names, gained/lost FDR calls, and NES-direction reversals. Every result file is bound to its DE input, generator, authority, collection membership, and output hash in its adjacent `*_FGSEA_provenance.tsv`.

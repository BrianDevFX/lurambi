# IEBC Lurambi places — 2022 historical baseline

This folder contains one import-ready place list for the **2022 General Election**. It is a historical baseline, not a current 2027 polling-place confirmation. Do not seed it automatically or assume the locations remain unchanged.

## Source and validation

- Source: IEBC, [Registered Voters per Polling Stations for the 2022 General Election](https://www.iebc.or.ke/docs/rov_per_polling_station.pdf).
- IEBC page also lists the 2022 statistics under [Downloads](https://www.iebc.or.ke/index.php/downloads/).
- Source PDF SHA-256: `7D9144DDBA1E866FC6A0BA62350C364C01613DD073C19E014451033F99FC3675`.
- Extracted 176 unique station-code rows across 98 centres, mapped to the six Lurambi wards in the existing migration.
- Ward row counts match the 2022 register totals: Butsotso East 24, Butsotso South 20, Butsotso Central 34, Sheywe 53, Mahiakalo 18, Shirere 27. The 176 source rows cover polling streams; the 98 centres are registration centres.
- Voter names, ID numbers and phone numbers are not included. Voter totals were used only to validate the transcription and are not included in the CSV.

## File format and import

`iebc-lurambi-2022-places.csv` has 98 `polling_centre` rows followed by 176 `polling_station` rows. Centre codes use the 13-digit IEBC centre-code prefix. Station labels include a `Stream NN` suffix derived from the final two digits of the 15-digit IEBC polling-station code, so repeated facility names remain distinct in the app. The full IEBC station code is retained in the CSV `code` column for reference.

To load the file manually, sign in as Admin, open **Import/Export**, choose **Wards, centres and stations**, select the CSV, and run a dry run before Import. The app current polling-station table does not persist the source `code` field; it saves station name and number. Do not describe the imported rows as current until the team verifies them against a newer IEBC list.

This reference file is not used by `npm run db:seed:dev` and is not applied by migrations.

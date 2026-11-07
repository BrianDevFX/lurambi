export interface Ward {
  id: string;
  name: string;
  code?: string;
  constituency_name?: string;
  county_name?: string;
  registered_voters_target?: number;
}

export interface PollingCentre { id: string; ward_id: string; name: string; code?: string; total_registered_voters?: number; }
export interface PollingStation { id: string; polling_centre_id: string; ward_id: string; station_name: string; station_number: number; registered_voters_est?: number; }
export interface PlaceAlias {
  id: string; raw_alias: string; canonical_type: 'ward' | 'polling_centre' | 'polling_station';
  target_ward_id?: string; target_polling_centre_id?: string; target_polling_station_id?: string;
  confidence: number; notes?: string;
}

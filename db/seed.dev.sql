INSERT INTO public.polling_centres(ward_id,name,synthetic)
SELECT w.id, 'Synthetic Centre '||lpad(n::text,2,'0'), true
FROM public.wards w CROSS JOIN generate_series(1,2) AS n
ON CONFLICT (ward_id,name) DO NOTHING;

INSERT INTO public.polling_stations(polling_centre_id,ward_id,station_name,station_number,synthetic)
SELECT c.id,c.ward_id,'Synthetic Station '||lpad(n::text,2,'0'),n,true
FROM public.polling_centres c CROSS JOIN generate_series(1,2) AS n WHERE c.synthetic
ON CONFLICT (polling_centre_id,station_name) DO NOTHING;

INSERT INTO public.network_contacts(type,name,ward_id,synthetic,exclude_from_campaign_exports)
SELECT fixture.contact_type,fixture.contact_name,w.id,true,fixture.contact_type='chp'
FROM public.wards w
CROSS JOIN LATERAL (VALUES
  ('pastor','Synthetic Pastor 01'),('pastor','Synthetic Pastor 02'),('pastor','Synthetic Pastor 03'),('pastor','Synthetic Pastor 04'),('pastor','Synthetic Pastor 05'),
  ('pastor','Synthetic Pastor 06'),('pastor','Synthetic Pastor 07'),('pastor','Synthetic Pastor 08'),('pastor','Synthetic Pastor 09'),('pastor','Synthetic Pastor 10'),
  ('chp','Synthetic CHP 01'),('chp','Synthetic CHP 02'),('chp','Synthetic CHP 03'),('chp','Synthetic CHP 04'),('chp','Synthetic CHP 05'),
  ('chp','Synthetic CHP 06'),('chp','Synthetic CHP 07'),('chp','Synthetic CHP 08'),('chp','Synthetic CHP 09'),('chp','Synthetic CHP 10')
) AS fixture(contact_type,contact_name)
WHERE NOT EXISTS (SELECT 1 FROM public.network_contacts nc WHERE nc.ward_id=w.id AND nc.name=fixture.contact_name)
LIMIT 120;

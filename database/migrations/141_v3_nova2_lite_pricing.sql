INSERT INTO ops.ai_model_prices(
  model_id,region,input_cost_microusd_per_million,output_cost_microusd_per_million,
  valid_from,source_url
) VALUES
 ('eu.amazon.nova-2-lite-v1:0','eu-central-1',429000,3597000,'2026-08-01T00:00:00Z',
  'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/index.json'),
 ('amazon.nova-2-lite-v1:0','eu-central-1',429000,3597000,'2026-08-01T00:00:00Z',
  'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/index.json'),
 ('us.amazon.nova-2-lite-v1:0','us-east-1',330000,2750000,'2026-08-01T00:00:00Z',
  'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/index.json')
ON CONFLICT(model_id,region,valid_from) DO UPDATE SET
 input_cost_microusd_per_million=EXCLUDED.input_cost_microusd_per_million,
 output_cost_microusd_per_million=EXCLUDED.output_cost_microusd_per_million,
 source_url=EXCLUDED.source_url;

INSERT INTO public.platform_schema_migrations(version)
VALUES('141_v3_nova2_lite_pricing') ON CONFLICT(version) DO NOTHING;

INSERT INTO assistant_classification (assistant_id, level1_code_id, level2_code_id, sort_order)
SELECT a.id, a.level1_code_id, a.level2_code_id, 0
FROM assistant a
WHERE NOT EXISTS (SELECT 1 FROM assistant_classification p WHERE p.assistant_id = a.id);

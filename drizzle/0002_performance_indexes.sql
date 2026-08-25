CREATE INDEX "products_business_name_idx" ON "products" USING btree ("business_id","name");--> statement-breakpoint
CREATE INDEX "sale_lines_product_idx" ON "sale_lines" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "sales_customer_idx" ON "sales" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "sales_employee_idx" ON "sales" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "stock_levels_business_product_idx" ON "stock_levels" USING btree ("business_id","product_id");--> statement-breakpoint
CREATE INDEX "stock_movements_business_time_idx" ON "stock_movements" USING btree ("business_id","created_at");
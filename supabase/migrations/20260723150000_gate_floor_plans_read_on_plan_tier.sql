-- floor_plans_select only checked has_active_access(), not plan tier. So a
-- manager who uploaded floor plans on Pro/Business, then downgraded to
-- Starter (while staying subscribed), kept full read access to floor plans
-- and pins forever, for their whole team — even though Starter is not
-- supposed to have this feature at all. Writes were already correctly
-- blocked by plan_includes_pro_features(); reads weren't. This closes that
-- gap so read access matches write access: Starter loses the feature
-- entirely on downgrade, same as every other Pro/Business-gated table.
--
-- Safe for the UI: snag.$id.tsx already uses .maybeSingle() for the floor
-- plan lookup, so a filtered-out row renders as "no plan attached" rather
-- than an error. add.tsx and insights.tsx already gate their floor_plans
-- queries behind canUseFloorPlans client-side, so a downgraded user won't
-- even attempt the fetch.
DROP POLICY IF EXISTS "floor_plans_select" ON public.floor_plans;
CREATE POLICY "floor_plans_select" ON public.floor_plans
FOR SELECT USING (
  (
    (SELECT auth.uid()) = user_id
    OR private.effective_manager_id((SELECT auth.uid())) = user_id
    OR EXISTS (
      SELECT 1 FROM public.subcontractors sc
      WHERE sc.email = (SELECT auth.email()) AND sc.user_id = floor_plans.user_id
    )
  )
  AND private.has_active_access(user_id)
  AND private.plan_includes_pro_features(user_id)
);

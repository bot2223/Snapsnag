-- snag_photos_read_restricted only let a user read a photo if the storage
-- folder (the uploader's own auth.uid()) matched their own uid exactly, or
-- they were a matching subcontractor. That's too narrow: photos are
-- uploaded by whichever team member (manager or site worker) created the
-- snag, but need to be visible to the *whole team* (manager + all their
-- site workers), not just the uploader. This broke previews whenever the
-- viewer wasn't the exact person who took the photo — e.g. a manager
-- viewing a site worker's snag, or one site worker viewing another's.
--
-- Fix: also allow read access when the folder owner (the uploader) and the
-- requester share the same effective manager — i.e. same team — mirroring
-- the access model already used on the snags table itself.
drop policy if exists "snag_photos_read_restricted" on storage.objects;

create policy "snag_photos_read_restricted" on storage.objects
for select
using (
  bucket_id = 'snag-photos'
  and (
    -- Uploader reading their own photo
    (storage.foldername(name))[1] = (auth.uid())::text
    -- Anyone on the same team as the uploader (manager <-> their site workers)
    or private.effective_manager_id(((storage.foldername(name))[1])::uuid)
       = private.effective_manager_id(auth.uid())
    -- Subcontractor assigned to the snag this photo belongs to
    or exists (
      select 1 from snags s
      where s.photo_url like '%' || objects.name
        and s.subcontractor_id = (
          select subcontractors.id from subcontractors
          where subcontractors.email = auth.email()
        )
    )
  )
);

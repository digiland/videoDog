-- 0015: courses and playlists — ordered groups of a creator's own videos.
-- Grouping only: a collection has no price, and access stays per video through
-- VideosService.checkAccess (CLAUDE.md §3.9).
--
-- course   — ordered sections ("Paper 1 — Algebra"), each with ordered videos.
-- playlist — one flat ordered list; no sections.
--
-- Ordering: sections by position; items by position within their section, with
-- unsectioned items (all of a playlist's) first. Positions are unique per scope and
-- the constraints are DEFERRABLE, so a reorder can run under SET CONSTRAINTS ... DEFERRED.

CREATE TYPE collection_kind AS ENUM ('course', 'playlist');
CREATE TYPE collection_state AS ENUM ('draft', 'published', 'unpublished');

-- Target for collection_items' (video_id, owner_id) FK: a creator can only group their own videos.
ALTER TABLE videos ADD CONSTRAINT videos_id_owner_key UNIQUE (id, owner_id);

CREATE TABLE collections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid NOT NULL REFERENCES users(id),
  kind          collection_kind NOT NULL,
  title         text NOT NULL,
  description   text,
  thumbnail_key text,
  state         collection_state NOT NULL DEFAULT 'draft',
  search_doc    tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED,
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collections_id_owner_key UNIQUE (id, owner_id),
  CONSTRAINT collections_id_kind_key UNIQUE (id, kind),
  CONSTRAINT collections_published_at_required CHECK (state <> 'published' OR published_at IS NOT NULL)
);
CREATE INDEX collections_owner_idx ON collections (owner_id, created_at DESC);
CREATE INDEX collections_published_idx ON collections (published_at DESC) WHERE state = 'published';
CREATE INDEX collections_search_idx ON collections USING GIN (search_doc);

-- Course sections. collection_kind is pinned to 'course' and FK'd with collection_id,
-- so a playlist can never have sections (and a course with sections can't become a playlist).
CREATE TABLE collection_sections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id   uuid NOT NULL,
  collection_kind collection_kind NOT NULL DEFAULT 'course' CHECK (collection_kind = 'course'),
  title           text NOT NULL,
  position        int NOT NULL CHECK (position >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (collection_id, collection_kind)
    REFERENCES collections (id, kind) ON DELETE CASCADE,
  CONSTRAINT collection_sections_id_collection_key UNIQUE (id, collection_id),
  CONSTRAINT collection_sections_position_key UNIQUE (collection_id, position)
    DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE collection_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL,
  owner_id      uuid NOT NULL,
  video_id      uuid NOT NULL,
  section_id    uuid,                                -- NULL for playlists / unsectioned course items
  position      int NOT NULL CHECK (position >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- Both FKs share owner_id: the video must belong to the collection's owner.
  FOREIGN KEY (collection_id, owner_id)
    REFERENCES collections (id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (video_id, owner_id)
    REFERENCES videos (id, owner_id) ON DELETE CASCADE,
  -- The section must belong to this collection. Deleting a section that still has
  -- items is refused: move or remove them first.
  FOREIGN KEY (section_id, collection_id)
    REFERENCES collection_sections (id, collection_id),
  CONSTRAINT collection_items_video_key UNIQUE (collection_id, video_id),
  CONSTRAINT collection_items_position_key UNIQUE NULLS NOT DISTINCT (collection_id, section_id, position)
    DEFERRABLE INITIALLY IMMEDIATE
);
-- "Which collections is this video in?" (video page, delete checks).
CREATE INDEX collection_items_video_idx ON collection_items (video_id);

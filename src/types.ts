export interface HoyolabImage {
  url: string;
  height?: number;
  width?: number;
  format?: string;
  size?: string;
  spoiler?: boolean;
  image_id?: string;
}

export interface HoyolabVideoResolution {
  name?: string;
  height?: string | number;
  width?: string | number;
  url: string;
  duration?: string | number;
}

export interface HoyolabVideo {
  id?: string;
  cover?: string;
  url?: string;
  is_vertical?: boolean;
  sub_type?: number;
  resolution?: HoyolabVideoResolution[];
  status?: string;
  cover_meta?: {
    url?: string;
    height?: number;
    width?: number;
    format?: string;
    spoiler?: boolean;
  } | null;
}

export interface HoyolabUgcLevelEntry {
  level_id: string;
  level?: {
    level_id: string;
    region: string;
    level_name?: string;
    desc?: string;
    play_type?: string;
    good_rate?: string;
    hot_score?: string;
    show_limit_play_num_str?: string;
    level_intro?: string;
  };
}

export interface HoyolabUgcModule {
  ugc_levels?: HoyolabUgcLevelEntry[];
  ugc_levels_count?: number;
}

export interface HoyolabPostEntry {
  post: {
    game_id?: number;
    post_id: string;
    uid: string;
    subject: string;
    content?: string;
    cover?: string;
    view_type: number;
    created_at?: number;
    is_deleted?: number;
    structured_content?: string;
    lang?: string;
    origin_lang?: string;
    has_cover?: boolean;
    desc?: string;
    multi_language_info?: {
      langs?: string[];
      lang_subject?: Record<string, string>;
    } | null;
  };
  topics?: Array<{
    id: number;
    name: string;
  }>;
  user: {
    uid: string;
    nickname: string;
    avatar_url?: string;
    certification?: {
      type?: number;
      icon_url?: string;
      desc?: string;
    } | null;
  };
  stat?: {
    view_num?: number;
    reply_num?: number;
    like_num?: number;
    bookmark_num?: number;
    share_num?: number;
  } | null;
  image_list?: HoyolabImage[];
  cover_list?: HoyolabImage[];
  classification?: {
    id?: string;
    name?: string;
  } | null;
  video?: HoyolabVideo | null;
  game?: {
    game_id?: number;
    game_name?: string;
    color?: string;
    background_color?: string;
  } | null;
  channel?: {
    id?: string;
    name?: string;
  } | null;
  ugc_module?: HoyolabUgcModule | null;
}

export interface HoyolabPostFullResponse {
  retcode: number;
  message: string;
  data?: {
    post?: HoyolabPostEntry | null;
  } | null;
}

export interface HoyolabGetPostIdResponse {
  retcode: number;
  message: string;
  data?: {
    post_id?: string;
  } | null;
}

export type ResolvedTarget =
  | {
      kind: "post";
      postId: string;
      lang?: string;
      canonicalUrl: string;
    }
  | {
      kind: "external";
      url: string;
      title?: string;
      description?: string;
      imageUrl?: string;
      siteName?: string;
      themeColor?: string;
    };

// Discord Component Embeds (https://docs.discord.com/developers/link-previews/component-embeds)
export interface UnfurledMediaItem {
  url: string;
}

export interface TextDisplayComponent {
  type: 10;
  content: string;
}

export interface ThumbnailComponent {
  type: 11;
  media: UnfurledMediaItem;
  description?: string;
  spoiler?: boolean;
}

export interface LinkButtonComponent {
  type: 2;
  style: 5;
  url: string;
  label?: string;
  emoji?: {
    id?: string;
    name?: string;
    animated?: boolean;
  };
  disabled?: boolean;
}

export interface SectionComponent {
  type: 9;
  components: TextDisplayComponent[];
  accessory: ThumbnailComponent | LinkButtonComponent;
}

export interface MediaGalleryItem {
  media: UnfurledMediaItem;
  description?: string;
  spoiler?: boolean;
}

export interface MediaGalleryComponent {
  type: 12;
  items: MediaGalleryItem[];
}

export interface SeparatorComponent {
  type: 14;
  divider?: boolean;
  spacing?: 1 | 2;
}

export interface ActionRowComponent {
  type: 1;
  components: LinkButtonComponent[];
}

export type ContainerChildComponent =
  | ActionRowComponent
  | SectionComponent
  | TextDisplayComponent
  | MediaGalleryComponent
  | SeparatorComponent;

export interface ContainerComponent {
  type: 17;
  accent_color?: number;
  spoiler?: boolean;
  components: ContainerChildComponent[];
}

export interface ComponentEmbedPayload {
  component: ContainerComponent;
}

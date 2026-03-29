export interface CutPiece {
  width_mm: number;
  height_mm: number;
  quantity: number;
  label: string;
  edge_sides: string[];
}

export interface QuotationLine {
  concept: string;
  quantity: number;
  unit: string;
  unit_price: number;
  subtotal: number;
}

export interface Quotation {
  lines: QuotationLine[];
  subtotal: number;
  margin_percent: number;
  margin_amount: number;
  total: number;
  notes: string;
}

export interface Board {
  material: string;
  thickness_mm: number;
  color: string;
  width_mm: number;
  height_mm: number;
  price_usd: number;
}

export interface AnalysisPlan {
  board_material: string;
  board_thickness_mm: number;
  board_color: string;
  boards_needed: number;
  waste_description: string;
  pieces: CutPiece[];
}

export interface PliegoItemDimensions {
  width_mm: number;
  height_mm: number;
  depth_mm: number;
}

export interface PliegoItem {
  code: string;
  name: string;
  quantity: number;
  description: string;
  dimensions: PliegoItemDimensions;
  material: string;
  thickness_mm: number;
  hardware: string[];
  edge_banding: string;
  group: string;
  delivery_location: string;
  delivery_days: number;
  wood_only: boolean;
}

export interface PliegoResult {
  items: PliegoItem[];
  general_specs: {
    materials: string;
    colors: string[];
    edge_banding: string;
    delivery_location: string;
    delivery_days: number;
    payment_terms: string;
    offer_maintenance_days: number;
    samples_required: string;
    required_forms: string[];
    bid_guarantee: string;
    performance_guarantee: string;
    product_warranty: string;
    other_conditions: string;
  };
}

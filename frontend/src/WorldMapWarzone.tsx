import React, { useEffect, useState, useCallback, useRef } from "react";
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import "./Grid.css";

type Props = {
  username: string;
  userColor: string;
  tokenBalance: number;
  setTokenBalance: React.Dispatch<React.SetStateAction<number>>;
};

const WorldMapWarzone: React.FC<Props> = ({ username, userColor, tokenBalance, setTokenBalance }) => {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const mapRef = useRef<L.Map | null>(null);
  const claimsRef = useRef<Map<string, { owner: string; color: string }>>(new Map());
  
  // Warzone benzeri değerler
  const totalDefenseUsed = selected.size; // Her seçili hücre 1 defense kullanır
  const currentStock = tokenBalance - totalDefenseUsed;

  const initializeMap = useCallback(() => {
    console.log('initializeMap called');
    
    // Map already created?
    if (mapRef.current) {
      console.log('Map already initialized');
      return;
    }
    
    // Harita container'ı kontrol et
    const mapContainer = document.getElementById('worldmap');
    if (!mapContainer) {
      console.error('Map container not found');
      return;
    }

    console.log('Creating map...');
    
    try {
      // Harita oluştur
      const map = L.map('worldmap', { 
        zoomSnap: 0.25, 
        worldCopyJump: true, 
        preferCanvas: true 
      }).setView([39.93, 32.86], 6); // Ankara merkez

      // keep instance
      mapRef.current = map;

    // CARTO Voyager haritası
    const cartoEN = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      {
        subdomains: 'abcd', 
        maxZoom: 12, 
        minZoom: 2, 
        crossOrigin: true,
        attribution: '&copy; OpenStreetMap contributors, &copy; CARTO'
      }
    ).addTo(map);

    // Grid sistemi (100 km hücreler)
    const LAT_MIN = -60.0, LAT_MAX = 85.0;
    const LON_MIN = -180.0, LON_MAX = 180.0;
    const SIDE_KM = 100.0;
    const KM_PER_DEG_LAT = 110.574;
    const ORIGIN_LAT = LAT_MIN, ORIGIN_LON = LON_MIN;

    const canvasRenderer = L.canvas({ padding: 0.2 });
    map.createPane('gridPane');
    const gridPane = map.getPane('gridPane');
    if (gridPane) {
      gridPane.style.zIndex = '450';
    }

    let gridGroup = L.layerGroup().addTo(map);

    const kmToLatDeg = (km: number) => { 
      return km / KM_PER_DEG_LAT; 
    };
    
    const kmToLonDeg = (km: number, latDeg: number) => {
      const latRad = latDeg * Math.PI / 180;
      const kmPerDegLon = 111.320 * Math.cos(latRad);
      return kmPerDegLon > 0.001 ? (km / kmPerDegLon) : 360;
    };
    
    const cellId = (ri: number, ci: number) => { 
      return 'r' + ri + 'c' + ci; 
    };

    const buildGrid = () => {
      gridGroup.clearLayers();
      
      const baseStyle = { 
        color: '#3388ff', 
        weight: 0.5, 
        fillColor: '#3388ff', 
        fillOpacity: 0.25 
      };
      
      const selStyle = { 
        color: userColor, 
        weight: 1.0, 
        fillColor: userColor, 
        fillOpacity: 0.8 
      };

      const latStep = kmToLatDeg(SIDE_KM);
      const vb = map.getBounds().pad(0.02);
      const south = Math.max(vb.getSouth(), LAT_MIN);
      const north = Math.min(vb.getNorth(), LAT_MAX);
      const west = Math.max(vb.getWest(), LON_MIN);
      const east = Math.min(vb.getEast(), LON_MAX);

      const startRow = Math.floor((south - ORIGIN_LAT) / latStep);
      const endRow = Math.ceil((north - ORIGIN_LAT) / latStep);

      let drawn = 0;
      for (let ri = startRow; ri < endRow; ri++) {
        const lat0 = ORIGIN_LAT + ri * latStep;
        const lat1 = Math.min(lat0 + latStep, LAT_MAX);
        const latMid = (lat0 + lat1) / 2;
        const lonStep = kmToLonDeg(SIDE_KM, latMid);
        const startCol = Math.floor((west - ORIGIN_LON) / lonStep);
        const endCol = Math.ceil((east - ORIGIN_LON) / lonStep);
        
        for (let ci = startCol; ci < endCol; ci++) {
          const lon0 = ORIGIN_LON + ci * lonStep;
          const lon1 = Math.min(lon0 + lonStep, LON_MAX);
          const id = cellId(ri, ci);
          
          const claim = claimsRef.current.get(id);
          const styleFor = () => {
            if (claim) {
              return {
                color: claim.color,
                weight: 1.0,
                fillColor: claim.color,
                fillOpacity: 0.8
              } as any;
            }
            return baseStyle as any;
          };
          const rect = L.rectangle(
            [[lat0, lon0], [lat1, lon1]],
            styleFor()
          );
          
          rect.on('click', async () => {
            if (loading) return;
            
            try {
              const current = claimsRef.current.get(id);
              if (current) {
                if (current.owner !== username) {
                  alert(`This cell is already claimed by ${current.owner}.`);
                  return;
                }
                // Unclaim if it's ours
                const resp = await fetch(`/worldmap/claim/${id}?username=${encodeURIComponent(username)}`, { method: 'DELETE' });
                if (resp.ok) {
                  claimsRef.current.delete(id);
                  setSelected(prev => { const s = new Set(prev); s.delete(id); return s; });
                  rect.setStyle(baseStyle);
                } else {
                  const j = await resp.json().catch(()=>({}));
                  if (j?.error === 'forbidden') alert('This cell is owned by another player.');
                }
                return;
              }
              // Claim new cell
              if (currentStock <= 0) {
                alert('⚠️ No available blocks for war! Mine more blocks in Digzone first.');
                return;
              }
              const resp = await fetch('/worldmap/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, username })
              });
              if (resp.ok) {
                const j = await resp.json();
                const color = String(j?.color || userColor);
                claimsRef.current.set(id, { owner: username, color });
                setSelected(prev => { const s = new Set(prev); s.add(id); return s; });
                rect.setStyle({ color, weight: 1.0, fillColor: color, fillOpacity: 0.8 });
              } else {
                const j = await resp.json().catch(()=>({}));
                if (j?.error === 'already_claimed') alert('This cell is already claimed.');
              }
            } catch {}
          });
          
          const ownerLabel = claim?.owner ? `<br>Owner: ${claim.owner}` : '';
          rect.bindTooltip(`ID: ${id}<br>Area ~ 10000 km²${ownerLabel}`, { sticky: true });
          rect.addTo(gridGroup);
          drawn++;
        }
      }
    }

    // Grid'i ilk defa oluştur
    buildGrid();

    // Harita hareket ettiğinde grid'i yeniden çiz
    let redrawTimer: NodeJS.Timeout | null = null;
    const scheduleRedraw = () => {
      if (redrawTimer) clearTimeout(redrawTimer);
      redrawTimer = setTimeout(buildGrid, 120);
    };
    
    map.on('moveend zoomend', scheduleRedraw);

      // Cleanup fonksiyonu
      return () => {
        if (redrawTimer) clearTimeout(redrawTimer);
      };
      
    } catch (error) {
      console.error('Error creating map:', error);
      alert('Failed to create map. Please refresh the page.');
    }
  }, [mapLoaded]);

  // Harita yükleme ve başlatma
  useEffect(() => {
    console.log('Leaflet imported, initializing map...');
    setMapLoaded(true);

    const timer = setTimeout(() => {
      console.log('Starting map initialization...');
      initializeMap();
    }, 200);

    return () => {
      clearTimeout(timer);
      if (mapRef.current) {
        try {
          mapRef.current.remove();
        } catch (e) {
          console.log('Map cleanup error:', e);
        }
        mapRef.current = null;
      }
    };
  }, [initializeMap]);

  // Initial load of claimed cells from server
  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch('/worldmap');
        const j = await resp.json();
        if (j?.ok && Array.isArray(j.cells)) {
          const map = new Map<string, { owner: string; color: string }>();
          for (const c of j.cells) {
            if (c?.id) map.set(String(c.id), { owner: String(c.owner || ''), color: String(c.color || '#3388ff') });
          }
          claimsRef.current = map;
          // Also reflect our own as selected in UI
          const mine = j.cells
            .filter((c:any)=>c.owner===username)
            .map((c:any)=>String(c.id));
          setSelected(new Set(mine));
        }
      } catch {}
    })();
  }, [username]);

  const handleClearSelected = () => {
    setSelected(new Set());
  };

  const handleExportJSON = () => {
    const out = Array.from(selected);
    const blob = new Blob([JSON.stringify({ selected: out }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'worldmap_selected_cells.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ 
      display: "flex", 
      flexDirection: "column", 
      alignItems: "center", 
      width: "100%",
      padding: "16px",
      boxSizing: "border-box"
    }}>
      {/* Control Bar */}
      <div style={{
        display: 'flex', 
        gap: 10, 
        alignItems: 'center', 
        marginBottom: 12,
        background: '#fff',
        padding: '10px 12px',
        borderRadius: '12px',
        boxShadow: '0 6px 20px rgba(0,0,0,.15)',
        flexWrap: 'wrap'
      }}>
        <button 
          onClick={handleClearSelected}
          style={{
            padding: '6px 10px',
            borderRadius: '10px',
            border: '1px solid #ddd',
            background: '#fff',
            cursor: 'pointer'
          }}
        >
          Clear Selected
        </button>
        <button 
          onClick={handleExportJSON}
          style={{
            padding: '6px 10px',
            borderRadius: '10px',
            border: '1px solid #ddd',
            background: '#fff',
            cursor: 'pointer'
          }}
        >
          Export JSON
        </button>
        <span style={{ fontSize: 12, color: '#555' }}>
          Selected: {selected.size} | Zoom to see cells
        </span>
      </div>

      {/* Balance Info */}
      <div style={{
        fontSize: 16,
        marginBottom: 12,
        color: currentStock > 0 ? "#2196f3" : "#ff5722",
        fontWeight: currentStock < 0 ? "bold" : 600
      }}>
        💰 Total: {tokenBalance} | 🏗️ Used: {totalDefenseUsed} | Available: {currentStock >= 0 ? currentStock : `${currentStock} (NEGATIVE!)`}
      </div>

      {/* Map Container */}
      <div 
        id="worldmap" 
        style={{ 
          height: '70vh', 
          width: '100%', 
          borderRadius: '8px',
          border: '1px solid #ddd'
        }}
      >
        {!mapLoaded && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100%',
            backgroundColor: '#f5f5f5',
            fontSize: '16px',
            gap: '10px'
          }}>
            <div>🗺️ Initializing world map...</div>
            <div style={{ fontSize: '12px', color: '#666' }}>
              Loading map components
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{
        marginTop: 12,
        background: '#fff',
        padding: '8px 10px',
        borderRadius: '10px',
        boxShadow: '0 6px 20px rgba(0,0,0,.15)',
        fontSize: 12
      }}>
        <div>
          <span style={{
            display: 'inline-block',
            width: 12,
            height: 12,
            borderRadius: 2,
            marginRight: 6,
            verticalAlign: 'middle',
            background: '#3388ff',
            opacity: 0.35
          }}></span>
          Cell (~100 km)
        </div>
        <div>
          <span style={{
            display: 'inline-block',
            width: 12,
            height: 12,
            borderRadius: 2,
            marginRight: 6,
            verticalAlign: 'middle',
            background: userColor,
            opacity: 0.8
          }}></span>
          Selected
        </div>
      </div>
    </div>
  );
};

export default WorldMapWarzone;

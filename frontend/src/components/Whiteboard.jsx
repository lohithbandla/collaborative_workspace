import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Pencil, Square, Circle, Type, Minus, Trash2, Undo, Redo, MousePointer2, Settings, Users, Wifi } from 'lucide-react';
import io from 'socket.io-client';

function pointToLineDistance(point, start, end) {
  const A = point.x - start.x;
  const B = point.y - start.y;
  const C = end.x - start.x;
  const D = end.y - start.y;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  if (lenSq !== 0) param = dot / lenSq;

  let xx, yy;
  if (param < 0) {
    xx = start.x;
    yy = start.y;
  } else if (param > 1) {
    xx = end.x;
    yy = end.y;
  } else {
    xx = start.x + param * C;
    yy = start.y + param * D;
  }

  const dx = point.x - xx;
  const dy = point.y - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

const Whiteboard = () => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const socketRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1200, height: 800 });

  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState('pencil');
  const [color, setColor] = useState('#000000');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [shapes, setShapes] = useState([]);
  const [currentShape, setCurrentShape] = useState(null);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isTyping, setIsTyping] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [textPosition, setTextPosition] = useState({ x: 0, y: 0 });
  const [selectedShapeId, setSelectedShapeId] = useState(null);
  const [dragOffset, setDragOffset] = useState(null);
  const [resizeHandle, setResizeHandle] = useState(null);
  const [showProperties, setShowProperties] = useState(false);
  
  // Socket.io states
  const [isConnected, setIsConnected] = useState(false);
  const [connectedUsers, setConnectedUsers] = useState([]);
  const [userCursors, setUserCursors] = useState({});
  const [userDrawings, setUserDrawings] = useState({});

  // Initialize Socket.io connection
  useEffect(() => {
    socketRef.current = io('http://localhost:3001', {
      transports: ['websocket']
    });

    const socket = socketRef.current;

    socket.on('connect', () => {
      setIsConnected(true);
      console.log('Connected to server');
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
      console.log('Disconnected from server');
    });

    // Receive initial whiteboard state
    socket.on('whiteboard-state', (state) => {
      setShapes(state.shapes);
      setHistory(state.history);
      setHistoryIndex(state.historyIndex);
    });

    // Handle shape updates from other users
    socket.on('shape-update', (data) => {
      if (data.type === 'add') {
        setShapes(prev => [...prev, data.shape]);
      } else if (data.type === 'update') {
        setShapes(prev => prev.map(s => s.id === data.shape.id ? data.shape : s));
      } else if (data.type === 'delete') {
        setShapes(prev => prev.filter(s => s.id !== data.shapeId));
      } else if (data.type === 'clear') {
        setShapes([]);
      } else if (data.type === 'replace-all') {
        setShapes(data.shapes);
      }
    });

    // Handle user drawing states
    socket.on('user-drawing', (data) => {
      setUserDrawings(prev => ({
        ...prev,
        [data.userId]: data.currentShape
      }));
    });

    // Handle user cursors
    socket.on('user-cursor', (data) => {
      setUserCursors(prev => ({
        ...prev,
        [data.userId]: data.cursor
      }));
    });

    // Handle user connections
    socket.on('users-update', (users) => {
      setConnectedUsers(users);
    });

    socket.on('user-joined', (user) => {
      setConnectedUsers(prev => [...prev, user]);
    });

    socket.on('user-left', (userId) => {
      setConnectedUsers(prev => prev.filter(u => u.id !== userId));
      setUserCursors(prev => {
        const newCursors = { ...prev };
        delete newCursors[userId];
        return newCursors;
      });
      setUserDrawings(prev => {
        const newDrawings = { ...prev };
        delete newDrawings[userId];
        return newDrawings;
      });
    });

    // Handle history updates
    socket.on('history-update', (data) => {
      setHistory(data.history);
      setHistoryIndex(data.historyIndex);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Update canvas size dynamically
  useEffect(() => {
    const updateSize = () => {
      if (!containerRef.current) return;
      setCanvasSize({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight - 140,
      });
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Send cursor movement to other users
  const sendCursorMovement = useCallback((pos) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit('cursor-move', {
        x: pos.x / canvasSize.width,
        y: pos.y / canvasSize.height
      });
    }
  }, [isConnected, canvasSize]);

  // Send shape updates to other users
  const sendShapeUpdate = useCallback((type, data) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit('shape-update', { type, ...data });
    }
  }, [isConnected]);

  // Send drawing state to other users
  const sendDrawingState = useCallback((isDrawing, currentShape) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit('drawing-state', { isDrawing, currentShape });
    }
  }, [isConnected]);

  // Save state to history and sync
  const saveToHistory = useCallback(() => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(JSON.parse(JSON.stringify(shapes)));
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    
    if (socketRef.current && isConnected) {
      socketRef.current.emit('history-update', {
        history: newHistory,
        historyIndex: newHistory.length - 1
      });
    }
  }, [shapes, history, historyIndex, isConnected]);

  const undo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const newShapes = JSON.parse(JSON.stringify(history[newIndex]));
      setHistoryIndex(newIndex);
      setShapes(newShapes);
      setSelectedShapeId(null);
      
      sendShapeUpdate('replace-all', { shapes: newShapes });
      if (socketRef.current && isConnected) {
        socketRef.current.emit('history-update', {
          history,
          historyIndex: newIndex
        });
      }
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const newShapes = JSON.parse(JSON.stringify(history[newIndex]));
      setHistoryIndex(newIndex);
      setShapes(newShapes);
      setSelectedShapeId(null);
      
      sendShapeUpdate('replace-all', { shapes: newShapes });
      if (socketRef.current && isConnected) {
        socketRef.current.emit('history-update', {
          history,
          historyIndex: newIndex
        });
      }
    }
  };

  const getCanvasCoordinates = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const getShapeBounds = (shape) => {
    if (shape.type === 'text') {
      const w = shape.text.length * (shape.fontSize * canvasSize.width / 2);
      const h = shape.fontSize * canvasSize.width;
      return {
        left: shape.x * canvasSize.width,
        top: shape.y * canvasSize.height - h,
        right: shape.x * canvasSize.width + w,
        bottom: shape.y * canvasSize.height
      };
    } else if (shape.type === 'rectangle') {
      return {
        left: Math.min(shape.startX, shape.endX) * canvasSize.width,
        top: Math.min(shape.startY, shape.endY) * canvasSize.height,
        right: Math.max(shape.startX, shape.endX) * canvasSize.width,
        bottom: Math.max(shape.startY, shape.endY) * canvasSize.height
      };
    } else if (shape.type === 'circle') {
      const r = Math.sqrt(Math.pow((shape.endX - shape.startX) * canvasSize.width, 2) + Math.pow((shape.endY - shape.startY) * canvasSize.height, 2));
      return {
        left: shape.startX * canvasSize.width - r,
        top: shape.startY * canvasSize.height - r,
        right: shape.startX * canvasSize.width + r,
        bottom: shape.startY * canvasSize.height + r
      };
    } else if (shape.type === 'line') {
      return {
        left: Math.min(shape.startX, shape.endX) * canvasSize.width,
        top: Math.min(shape.startY, shape.endY) * canvasSize.height,
        right: Math.max(shape.startX, shape.endX) * canvasSize.width,
        bottom: Math.max(shape.startY, shape.endY) * canvasSize.height
      };
    } else if (shape.type === 'pencil') {
      const xs = shape.points.map(p => p.x * canvasSize.width);
      const ys = shape.points.map(p => p.y * canvasSize.height);
      return {
        left: Math.min(...xs),
        top: Math.min(...ys),
        right: Math.max(...xs),
        bottom: Math.max(...ys)
      };
    }
    return { left: 0, top: 0, right: 0, bottom: 0 };
  };

  const getResizeHandle = (pos, shape) => {
    const bounds = getShapeBounds(shape);
    const handleSize = 8;
    
    if (Math.abs(pos.x - bounds.left) < handleSize && Math.abs(pos.y - bounds.top) < handleSize) return 'nw';
    if (Math.abs(pos.x - bounds.right) < handleSize && Math.abs(pos.y - bounds.top) < handleSize) return 'ne';
    if (Math.abs(pos.x - bounds.left) < handleSize && Math.abs(pos.y - bounds.bottom) < handleSize) return 'sw';
    if (Math.abs(pos.x - bounds.right) < handleSize && Math.abs(pos.y - bounds.bottom) < handleSize) return 'se';
    if (Math.abs(pos.x - bounds.left) < handleSize && pos.y > bounds.top + handleSize && pos.y < bounds.bottom - handleSize) return 'w';
    if (Math.abs(pos.x - bounds.right) < handleSize && pos.y > bounds.top + handleSize && pos.y < bounds.bottom - handleSize) return 'e';
    if (Math.abs(pos.y - bounds.top) < handleSize && pos.x > bounds.left + handleSize && pos.x < bounds.right - handleSize) return 'n';
    if (Math.abs(pos.y - bounds.bottom) < handleSize && pos.x > bounds.left + handleSize && pos.x < bounds.right - handleSize) return 's';
    
    return null;
  };

  const startDrawing = (e) => {
    const pos = getCanvasCoordinates(e);
    setStartPos(pos);
    setIsDrawing(true);

    if (tool === 'text') {
      setTextPosition(pos);
      setIsTyping(true);
      setTextInput('');
      return;
    }

    if (tool === 'select') {
      const selectedShape = shapes.find(shape => shape.id === selectedShapeId);
      
      if (selectedShape) {
        const handle = getResizeHandle(pos, selectedShape);
        if (handle) {
          setResizeHandle(handle);
          return;
        }
      }

      const clickedShape = shapes.find(shape => {
        const px = pos.x / canvasSize.width;
        const py = pos.y / canvasSize.height;

        if (shape.type === 'text') {
          const w = shape.text.length * (shape.fontSize / 2);
          const h = shape.fontSize;
          return px >= shape.x && px <= shape.x + w / canvasSize.width && py >= shape.y - h / canvasSize.height && py <= shape.y;
        } else if (shape.type === 'rectangle') {
          return px >= Math.min(shape.startX, shape.endX) && px <= Math.max(shape.startX, shape.endX) &&
                 py >= Math.min(shape.startY, shape.endY) && py <= Math.max(shape.startY, shape.endY);
        } else if (shape.type === 'circle') {
          const r = Math.sqrt(Math.pow(shape.endX - shape.startX, 2) + Math.pow(shape.endY - shape.startY, 2));
          const dist = Math.sqrt(Math.pow(px - shape.startX, 2) + Math.pow(py - shape.startY, 2));
          return dist <= r;
        } else if (shape.type === 'line') {
          const dist = pointToLineDistance({x: px, y: py}, {x: shape.startX, y: shape.startY}, {x: shape.endX, y: shape.endY});
          return dist <= 0.01;
        } else if (shape.type === 'pencil') {
          for (let i = 0; i < shape.points.length - 1; i++) {
            const dist = pointToLineDistance({x: px, y: py}, shape.points[i], shape.points[i + 1]);
            if (dist <= 0.01) return true;
          }
          return false;
        }
        return false;
      });

      if (clickedShape) {
        setSelectedShapeId(clickedShape.id);
        setDragOffset({ x: pos.x, y: pos.y });
      } else {
        setSelectedShapeId(null);
      }
      return;
    }

    const newShape = {
      id: Date.now() + Math.random(),
      type: tool,
      startX: pos.x / canvasSize.width,
      startY: pos.y / canvasSize.height,
      endX: pos.x / canvasSize.width,
      endY: pos.y / canvasSize.height,
      color,
      strokeWidth,
      points: tool === 'pencil' ? [{ x: pos.x / canvasSize.width, y: pos.y / canvasSize.height }] : []
    };
    setCurrentShape(newShape);
    sendDrawingState(true, newShape);
  };

  const draw = (e) => {
    const pos = getCanvasCoordinates(e);
    
    // Send cursor position
    sendCursorMovement(pos);

    if (resizeHandle && selectedShapeId) {
      const shape = shapes.find(s => s.id === selectedShapeId);
      if (!shape) return;

      const bounds = getShapeBounds(shape);
      const dx = pos.x - startPos.x;
      const dy = pos.y - startPos.y;

      setShapes(prev => prev.map(s => {
        if (s.id !== selectedShapeId) return s;

        if (s.type === 'rectangle' || s.type === 'line') {
          let newShape = { ...s };
          
          if (resizeHandle.includes('n')) newShape.startY = (bounds.top + dy) / canvasSize.height;
          if (resizeHandle.includes('s')) newShape.endY = (bounds.bottom + dy) / canvasSize.height;
          if (resizeHandle.includes('w')) newShape.startX = (bounds.left + dx) / canvasSize.width;
          if (resizeHandle.includes('e')) newShape.endX = (bounds.right + dx) / canvasSize.width;

          sendShapeUpdate('update', { shape: newShape });
          return newShape;
        } else if (s.type === 'circle') {
          const centerX = s.startX * canvasSize.width;
          const centerY = s.startY * canvasSize.height;
          const newRadius = Math.max(10, Math.sqrt(Math.pow(pos.x - centerX, 2) + Math.pow(pos.y - centerY, 2)));
          const newShape = {
            ...s,
            endX: (centerX + newRadius) / canvasSize.width,
            endY: (centerY + newRadius) / canvasSize.height
          };
          sendShapeUpdate('update', { shape: newShape });
          return newShape;
        } else if (s.type === 'text') {
          const scaleX = Math.abs(dx) / (bounds.right - bounds.left) + 1;
          const newShape = {
            ...s,
            fontSize: Math.max(0.01, s.fontSize * Math.max(0.5, scaleX))
          };
          sendShapeUpdate('update', { shape: newShape });
          return newShape;
        }

        return s;
      }));
      return;
    }

    if (tool === 'select' && selectedShapeId && dragOffset && !resizeHandle) {
      setShapes(prev => prev.map(shape => {
        if (shape.id !== selectedShapeId) return shape;
        const dx = (pos.x - dragOffset.x) / canvasSize.width;
        const dy = (pos.y - dragOffset.y) / canvasSize.height;
        const newShape = shape.type === 'text' 
          ? { ...shape, x: shape.x + dx, y: shape.y + dy }
          : {
              ...shape,
              startX: shape.startX + dx,
              startY: shape.startY + dy,
              endX: shape.endX + dx,
              endY: shape.endY + dy,
              points: shape.points?.map(p => ({ x: p.x + dx, y: p.y + dy }))
            };
        
        sendShapeUpdate('update', { shape: newShape });
        return newShape;
      }));
      setDragOffset(pos);
      return;
    }

    if (!isDrawing || isTyping) return;

    if (tool === 'pencil') {
      const updatedShape = { 
        ...currentShape, 
        points: [...currentShape.points, { x: pos.x / canvasSize.width, y: pos.y / canvasSize.height }]
      };
      setCurrentShape(updatedShape);
      sendDrawingState(true, updatedShape);
    } else {
      const updatedShape = { ...currentShape, endX: pos.x / canvasSize.width, endY: pos.y / canvasSize.height };
      setCurrentShape(updatedShape);
      sendDrawingState(true, updatedShape);
    }
  };

  const stopDrawing = () => {
    if (tool === 'select') {
      setDragOffset(null);
      setResizeHandle(null);
      if (selectedShapeId && (dragOffset || resizeHandle)) {
        saveToHistory();
      }
      return;
    }

    if (!isDrawing || isTyping) return;

    setIsDrawing(false);
    sendDrawingState(false, null);
    
    if (currentShape) {
      const newShapes = [...shapes, currentShape];
      setShapes(newShapes);
      setCurrentShape(null);
      
      sendShapeUpdate('add', { shape: currentShape });
      saveToHistory();
      
      setTool('select');
      setSelectedShapeId(currentShape.id);
      setShowProperties(true);
    }
  };

  const addText = () => {
    if (textInput.trim()) {
      const textShape = {
        id: Date.now() + Math.random(),
        type: 'text',
        x: textPosition.x / canvasSize.width,
        y: textPosition.y / canvasSize.height,
        text: textInput,
        color,
        fontSize: strokeWidth * 0.005
      };
      setShapes(prev => [...prev, textShape]);
      sendShapeUpdate('add', { shape: textShape });
      saveToHistory();
      
      setTool('select');
      setSelectedShapeId(textShape.id);
      setShowProperties(true);
    }
    setIsTyping(false);
    setTextInput('');
  };

  const clearCanvas = () => {
    setShapes([]);
    setCurrentShape(null);
    setSelectedShapeId(null);
    sendShapeUpdate('clear');
    saveToHistory();
  };

  const deleteSelected = () => {
    if (selectedShapeId) {
      setShapes(prev => prev.filter(shape => shape.id !== selectedShapeId));
      sendShapeUpdate('delete', { shapeId: selectedShapeId });
      setSelectedShapeId(null);
      setShowProperties(false);
      saveToHistory();
    }
  };

  const updateSelectedShapeProperty = (property, value) => {
    if (!selectedShapeId) return;
    setShapes(prev => prev.map(shape => {
      if (shape.id === selectedShapeId) {
        const updatedShape = { ...shape, [property]: value };
        sendShapeUpdate('update', { shape: updatedShape });
        return updatedShape;
      }
      return shape;
    }));
  };

  const getSelectedShape = () => shapes.find(shape => shape.id === selectedShapeId);

  // Handle mouse move for cursor tracking
  const handleMouseMove = (e) => {
    const pos = getCanvasCoordinates(e);
    sendCursorMovement(pos);
    draw(e);
  };

      // Draw shapes on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const w = canvas.width;
    const h = canvas.height;

    // Draw all shapes (local and from other users)
    [...shapes, currentShape, ...Object.values(userDrawings)].filter(Boolean).forEach(shape => {
      ctx.strokeStyle = shape.color;
      ctx.fillStyle = shape.color;
      ctx.lineWidth = shape.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      switch (shape.type) {
        case 'pencil':
          if (shape.points && shape.points.length > 1) {
            ctx.beginPath();
            ctx.moveTo(shape.points[0].x * w, shape.points[0].y * h);
            shape.points.forEach(p => ctx.lineTo(p.x * w, p.y * h));
            ctx.stroke();
          }
          break;
        case 'rectangle':
          ctx.beginPath();
          ctx.rect(shape.startX * w, shape.startY * h, (shape.endX - shape.startX) * w, (shape.endY - shape.startY) * h);
          ctx.stroke();
          break;
        case 'circle':
          const radius = Math.sqrt(Math.pow((shape.endX - shape.startX) * w, 2) + Math.pow((shape.endY - shape.startY) * h, 2));
          ctx.beginPath();
          ctx.arc(shape.startX * w, shape.startY * h, radius, 0, 2 * Math.PI);
          ctx.stroke();
          break;
        case 'line':
          ctx.beginPath();
          ctx.moveTo(shape.startX * w, shape.startY * h);
          ctx.lineTo(shape.endX * w, shape.endY * h);
          ctx.stroke();
          break;
        case 'text':
          ctx.font = `${shape.fontSize * w}px Arial`;
          ctx.fillText(shape.text, shape.x * w, shape.y * h);
          break;
      }

      // Draw selection handles for local selected shape
      if (selectedShapeId === shape.id && tool === 'select') {
        const bounds = getShapeBounds(shape);
        
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = 'blue';
        ctx.lineWidth = 1;
        ctx.strokeRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
        ctx.setLineDash([]);

        const handleSize = 6;
        ctx.fillStyle = 'blue';
        const handles = [
          [bounds.left, bounds.top], [bounds.right, bounds.top],
          [bounds.left, bounds.bottom], [bounds.right, bounds.bottom],
          [bounds.left, (bounds.top + bounds.bottom) / 2],
          [bounds.right, (bounds.top + bounds.bottom) / 2],
          [(bounds.left + bounds.right) / 2, bounds.top],
          [(bounds.left + bounds.right) / 2, bounds.bottom]
        ];
        
        handles.forEach(([x, y]) => {
          ctx.fillRect(x - handleSize/2, y - handleSize/2, handleSize, handleSize);
        });
      }
    });

    // Draw other users' cursors
    Object.entries(userCursors).forEach(([userId, cursor]) => {
      const user = connectedUsers.find(u => u.id === userId);
      if (user && cursor) {
        const x = cursor.x * w;
        const y = cursor.y * h;
        
        // Draw cursor
        ctx.fillStyle = user.color;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 12, y + 4);
        ctx.lineTo(x + 5, y + 10);
        ctx.closePath();
        ctx.fill();
        
        // Draw user name
        ctx.fillStyle = user.color;
        ctx.font = '12px Arial';
        ctx.fillText(`User ${userId.slice(-4)}`, x + 15, y - 5);
      }
    });

  }, [shapes, currentShape, selectedShapeId, canvasSize, tool, userDrawings, userCursors, connectedUsers]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { 
        e.preventDefault(); 
        if (e.shiftKey) redo(); else undo(); 
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { 
        e.preventDefault(); 
        redo(); 
      }
      if (isTyping && e.key === 'Enter') addText();
      if (isTyping && e.key === 'Escape') { 
        setIsTyping(false); 
        setTextInput(''); 
      }
      if (e.key === 'Delete' && selectedShapeId && !isTyping) deleteSelected();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isTyping, textInput, historyIndex, history, selectedShapeId]);

  useEffect(() => {
    if (history.length === 0) { 
      setHistory([[]]); 
      setHistoryIndex(0); 
    }
  }, []);

  const tools = [
    { id: 'select', icon: MousePointer2, name: 'Select' },
    { id: 'pencil', icon: Pencil, name: 'Pencil' },
    { id: 'rectangle', icon: Square, name: 'Rectangle' },
    { id: 'circle', icon: Circle, name: 'Circle' },
    { id: 'line', icon: Minus, name: 'Line' },
    { id: 'text', icon: Type, name: 'Text' }
  ];

  const colors = ['#000000', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#FFA500'];
  const selectedShape = getSelectedShape();

  return (
    <div className="flex flex-col h-screen bg-gray-100" ref={containerRef}>
      <div className="bg-white shadow-md p-4 flex flex-wrap items-center gap-4">
        <div className="flex gap-2">
          {tools.map(({ id, icon: Icon, name }) => (
            <button 
              key={id} 
              onClick={() => setTool(id)}
              className={`p-2 rounded-lg transition-colors ${tool === id ? 'bg-blue-500 text-white' : 'bg-gray-200 hover:bg-gray-300'}`} 
              title={name}
            >
              <Icon size={20} />
            </button>
          ))}
        </div>
        
        <div className="flex gap-2">
          {colors.map(c => (
            <button 
              key={c} 
              onClick={() => setColor(c)}
              className={`w-8 h-8 rounded-full border-2 transition-transform ${color === c ? 'border-gray-800 scale-110' : 'border-gray-300'}`}
              style={{ backgroundColor: c }} 
              title={c} 
            />
          ))}
        </div>
        
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Size:</label>
          <input 
            type="range" 
            min="1" 
            max="10" 
            value={strokeWidth} 
            onChange={e => setStrokeWidth(parseInt(e.target.value))} 
            className="w-20" 
          />
          <span className="text-sm text-gray-600 min-w-[2rem]">{strokeWidth}px</span>
        </div>
        
        <div className="flex gap-2 ml-auto">
          {/* Connection Status */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100">
            <Wifi size={16} className={isConnected ? 'text-green-500' : 'text-red-500'} />
            <span className="text-sm">{isConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
          
          {/* Users Count */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100">
            <Users size={16} />
            <span className="text-sm">{connectedUsers.length} user{connectedUsers.length !== 1 ? 's' : ''}</span>
          </div>
          
          <button 
            onClick={undo} 
            disabled={historyIndex <= 0} 
            className="p-2 rounded-lg bg-gray-200 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed" 
            title="Undo"
          >
            <Undo size={20} />
          </button>
          
          <button 
            onClick={redo} 
            disabled={historyIndex >= history.length - 1} 
            className="p-2 rounded-lg bg-gray-200 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed" 
            title="Redo"
          >
            <Redo size={20} />
          </button>
          
          <button 
            onClick={() => setShowProperties(!showProperties)} 
            disabled={!selectedShape} 
            className="p-2 rounded-lg bg-gray-200 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed" 
            title="Properties"
          >
            <Settings size={20} />
          </button>
          
          <button 
            onClick={clearCanvas} 
            className="p-2 rounded-lg bg-red-500 text-white hover:bg-red-600" 
            title="Clear"
          >
            <Trash2 size={20} />
          </button>
        </div>
      </div>

      {/* Properties Panel */}
      {showProperties && selectedShape && (
        <div className="bg-white border-b shadow-sm p-4 flex items-center gap-4">
          <span className="text-sm font-medium">Selected {selectedShape.type}:</span>
          <div className="flex items-center gap-2">
            <label className="text-sm">Color:</label>
            <input 
              type="color" 
              value={selectedShape.color} 
              onChange={e => updateSelectedShapeProperty('color', e.target.value)}
              className="w-8 h-8 rounded border cursor-pointer"
            />
          </div>
          {selectedShape.type !== 'text' && (
            <div className="flex items-center gap-2">
              <label className="text-sm">Stroke:</label>
              <input 
                type="range" 
                min="1" 
                max="20" 
                value={selectedShape.strokeWidth} 
                onChange={e => updateSelectedShapeProperty('strokeWidth', parseInt(e.target.value))}
                className="w-20"
              />
              <span className="text-sm min-w-[2rem]">{selectedShape.strokeWidth}px</span>
            </div>
          )}
          {selectedShape.type === 'text' && (
            <div className="flex items-center gap-2">
              <label className="text-sm">Size:</label>
              <input 
                type="range" 
                min="0.005" 
                max="0.1" 
                step="0.005"
                value={selectedShape.fontSize} 
                onChange={e => updateSelectedShapeProperty('fontSize', parseFloat(e.target.value))}
                className="w-20"
              />
              <span className="text-sm min-w-[3rem]">{Math.round(selectedShape.fontSize * canvasSize.width)}px</span>
            </div>
          )}
          <button 
            onClick={deleteSelected} 
            className="ml-4 px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm"
          >
            Delete
          </button>
        </div>
      )}

      <div className="flex-1 relative">
        <canvas 
          ref={canvasRef} 
          width={canvasSize.width} 
          height={canvasSize.height}
          className="absolute inset-0 bg-white cursor-crosshair"
          onMouseDown={startDrawing} 
          onMouseMove={handleMouseMove} 
          onMouseUp={stopDrawing} 
          onMouseLeave={stopDrawing} 
        />

        {isTyping && (
          <input 
            type="text" 
            value={textInput} 
            onChange={e => setTextInput(e.target.value)}
            onKeyDown={e => { 
              if (e.key === 'Enter') addText(); 
              else if (e.key === 'Escape') { 
                setIsTyping(false); 
                setTextInput(''); 
              } 
            }}
            className="absolute border-2 border-blue-500 px-2 py-1 bg-white rounded"
            style={{ 
              left: textPosition.x, 
              top: textPosition.y - 20, 
              fontSize: `${strokeWidth*8}px`, 
              color 
            }} 
            autoFocus 
            placeholder="Type text..." 
          />
        )}
      </div>

      <div className="bg-gray-50 p-3 text-sm text-gray-600">
        <div className="flex flex-wrap gap-4">
          <span><strong>Real-time Collaboration:</strong> {isConnected ? 'Connected' : 'Disconnected'}</span>
          <span><strong>Active Users:</strong> {connectedUsers.length}</span>
          <span><strong>Enhanced Workflow:</strong> Draw any shape and it automatically becomes selected for immediate editing</span>
          <span><strong>Shortcuts:</strong> Ctrl+Z (Undo), Delete (Remove selected)</span>
        </div>
      </div>
    </div>
  );
};

export default Whiteboard;
"use client";

import { useState, useEffect, useRef, memo } from "react";
import { openDB } from "idb";
import {
  ImageIcon,
  FolderPlus,
  MoreHorizontal,
  Trash2,
  Edit,
  Plus,
  X,
  Check,
  ChevronLeft,
  Search,
  Play,
  Folder,
  ArrowLeft,
  ArrowRight,
  Download,
} from "lucide-react";
import { cn } from "../lib/utils";

// Função para gerar um ID único
const generateId = () => `id-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// Função para formatar a data
const formatDate = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

// Inicializar o IndexedDB
const initDB = async () => {
  return openDB("photo-gallery-db", 2, {
    upgrade(db, oldVersion) {
      // Explicitly create stores if they don't exist
      if (!db.objectStoreNames.contains("files")) {
        db.createObjectStore("files", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("photos")) {
        db.createObjectStore("photos", { keyPath: "id" });
      }
    },
  });
};

// Custom hook para debounce
const useDebounce = (callback, delay) => {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    const handler = setTimeout(() => {
      callbackRef.current();
    }, delay);

    return () => clearTimeout(handler);
  }, [delay]);
};

function PhotoGallery() {
  const [photos, setPhotos] = useState([]);
  const [albums, setAlbums] = useState(() => {
    const savedAlbums = localStorage.getItem("gallery-albums");
    return savedAlbums ? JSON.parse(savedAlbums) : [{ id: "all", name: "Todas as Fotos", isDefault: true }];
  });

  const [selectedView, setSelectedView] = useState("all");
  const [selectedItems, setSelectedItems] = useState([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const [viewMode, setViewMode] = useState("grid");
  const [currentPhoto, setCurrentPhoto] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [isAddingAlbum, setIsAddingAlbum] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState("");
  const [isRenamingItem, setIsRenamingItem] = useState(null);
  const [newItemName, setNewItemName] = useState("");
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, itemId: null });
  const [showSidebar, setShowSidebar] = useState(true);
  const [draggedItem, setDraggedItem] = useState(null);
  const [dragOverAlbum, setDragOverAlbum] = useState(null);

  const fileInputRef = useRef(null);
  const renameInputRef = useRef(null);
  const albumInputRef = useRef(null);
  const dbRef = useRef(null);

  // Cache for photo URLs to prevent flickering
  const urlCache = useRef(new Map());

  // Inicializar o banco de dados e carregar fotos
  useEffect(() => {
    const setupDB = async () => {
      dbRef.current = await initDB();
      // Load photos from IndexedDB
      const tx = dbRef.current.transaction("photos", "readonly");
      const store = tx.objectStore("photos");
      const allPhotos = await store.getAll();
      setPhotos(allPhotos);
    };
    setupDB();
  }, []);

  // Persistir álbuns no localStorage com debounce
  useDebounce(() => {
    localStorage.setItem("gallery-albums", JSON.stringify(albums));
  }, 500, [albums]);

  // Fechar menu de contexto ao clicar fora
  useEffect(() => {
    const handleClickOutside = () => {
      setContextMenu({ visible: false, x: 0, y: 0, itemId: null });
    };

    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  // Focar o input quando o modal de renomeação abrir
  useEffect(() => {
    if (isRenamingItem && renameInputRef.current) {
      renameInputRef.current.focus();
    }
  }, [isRenamingItem]);

  // Focar o input quando o modal de criação de álbum abrir
  useEffect(() => {
    if (isAddingAlbum && albumInputRef.current) {
      albumInputRef.current.focus();
    }
  }, [isAddingAlbum]);

  // Filtrar fotos com base na visualização atual e termo de pesquisa
  const filteredPhotos = photos.filter((photo) => {
    const inSelectedAlbum = selectedView === "all" || (photo.albums && photo.albums.includes(selectedView));
    const matchesSearch = !searchTerm || photo.name.toLowerCase().includes(searchTerm.toLowerCase());
    return inSelectedAlbum && matchesSearch;
  });

  // Agrupar fotos por data
  const groupedPhotos = filteredPhotos.reduce((groups, photo) => {
    const date = photo.date.split("T")[0];
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(photo);
    return groups;
  }, {});

  // Ordenar datas em ordem decrescente
  const sortedDates = Object.keys(groupedPhotos).sort((a, b) => new Date(b) - new Date(a));

  // Função para carregar a URL de um arquivo do IndexedDB
  const loadFileUrl = async (fileId) => {
    if (!dbRef.current || !fileId) return "/placeholder.svg";

    // Check cache first
    if (urlCache.current.has(fileId)) {
      return urlCache.current.get(fileId);
    }

    const tx = dbRef.current.transaction("files", "readonly");
    const store = tx.objectStore("files");
    const file = await store.get(fileId);
    if (file && file.blob) {
      const url = URL.createObjectURL(file.blob);
      urlCache.current.set(fileId, url);
      return url;
    }
    return "/placeholder.svg";
  };

  // Manipuladores de eventos
  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    try {
      if (!dbRef.current) {
        dbRef.current = await initDB();
      }

      const newPhotos = await Promise.all(
        files.map(async (file) => {
          const fileId = generateId();
          const fileType = file.type.startsWith("video/") ? "video" : "image";

          // Ensure transactions are properly created and awaited
          const fileTx = dbRef.current.transaction("files", "readwrite");
          const fileStore = fileTx.objectStore("files");
          await fileStore.put({ id: fileId, blob: file });
          await fileTx.done;

          const newPhoto = {
            id: fileId,
            name: file.name,
            fileId: fileId,
            type: fileType,
            size: file.size,
            date: new Date().toISOString(),
            albums: ["all"],
          };

          if (selectedView !== "all") {
            newPhoto.albums.push(selectedView);
          }

          // Ensure photo transaction is properly created and awaited
          const photoTx = dbRef.current.transaction("photos", "readwrite");
          const photoStore = photoTx.objectStore("photos");
          await photoStore.put(newPhoto);
          await photoTx.done;

          return newPhoto;
        })
      );

      // Update photos state with new uploads
      setPhotos((prev) => [...prev, ...newPhotos]);
      
      // Clear file input
      if (fileInputRef.current) {
        fileInputRef.current.value = null;
      }
    } catch (error) {
      console.error("Error uploading files:", error);
      alert("Failed to upload files. Please try again.");
    }
  };

  const handleDeletePhotos = async (photoIds) => {
    if (!dbRef.current) return;

    try {
      // Remover os arquivos do IndexedDB (files store)
      const fileTx = dbRef.current.transaction("files", "readwrite");
      const fileStore = fileTx.objectStore("files");
      await Promise.all(photoIds.map((id) => fileStore.delete(id)));
      await fileTx.done;

      // Remover os metadados do IndexedDB (photos store)
      const photoTx = dbRef.current.transaction("photos", "readwrite");
      const photoStore = photoTx.objectStore("photos");
      await Promise.all(photoIds.map((id) => photoStore.delete(id)));
      await photoTx.done;

      // Limpar o cache de URLs
      photoIds.forEach((id) => {
        if (urlCache.current.has(id)) {
          URL.revokeObjectURL(urlCache.current.get(id));
          urlCache.current.delete(id);
        }
      });

      // Atualizar o estado
      setPhotos((prev) => prev.filter((photo) => !photoIds.includes(photo.id)));
      setSelectedItems([]);
      setIsSelecting(false);
      setContextMenu({ visible: false, x: 0, y: 0, itemId: null });
      setCurrentPhoto(null);
      setViewMode("grid");
    } catch (error) {
      console.error("Error deleting photos:", error);
      alert("Failed to delete photos. Please try again.");
    }
  };

  const handleDeleteAlbum = (albumId) => {
    if (albumId === "all") return;

    setAlbums((prev) => prev.filter((album) => album.id !== albumId));

    const updatedPhotos = photos.map((photo) => ({
      ...photo,
      albums: (photo.albums || []).filter((id) => id !== albumId),
    }));

    // Atualizar os metadados no IndexedDB
    const updatePhotosInDB = async () => {
      try {
        const tx = dbRef.current.transaction("photos", "readwrite");
        const store = tx.objectStore("photos");
        await Promise.all(updatedPhotos.map((photo) => store.put(photo)));
        await tx.done;
      } catch (error) {
        console.error("Error updating photos after album deletion:", error);
      }
    };
    updatePhotosInDB();

    setPhotos(updatedPhotos);

    if (selectedView === albumId) {
      setSelectedView("all");
    }
  };

  const handleAddToAlbum = async (photoId, albumId) => {
    if (albumId === "all") return;

    const updatedPhotos = photos.map((photo) => {
      if (photo.id === photoId) {
        if (!photo.albums || !photo.albums.includes(albumId)) {
          return {
            ...photo,
            albums: [...(photo.albums || []), albumId],
          };
        }
      }
      return photo;
    });

    // Atualizar os metadados no IndexedDB
    try {
      const tx = dbRef.current.transaction("photos", "readwrite");
      const store = tx.objectStore("photos");
      const photoToUpdate = updatedPhotos.find((photo) => photo.id === photoId);
      if (photoToUpdate) {
        await store.put(photoToUpdate);
        await tx.done;
      }
    } catch (error) {
      console.error("Error adding photo to album:", error);
      return;
    }

    setPhotos(updatedPhotos);
    setContextMenu({ visible: false, x: 0, y: 0, itemId: null });
    setDraggedItem(null);
    setDragOverAlbum(null);
  };

  const handleRemoveFromAlbum = async (photoId, albumId) => {
    if (albumId === "all") return;

    const updatedPhotos = photos.map((photo) => {
      if (photo.id === photoId) {
        return {
          ...photo,
          albums: (photo.albums || []).filter((id) => id !== albumId),
        };
      }
      return photo;
    });

    // Atualizar os metadados no IndexedDB
    try {
      const tx = dbRef.current.transaction("photos", "readwrite");
      const store = tx.objectStore("photos");
      const photoToUpdate = updatedPhotos.find((photo) => photo.id === photoId);
      if (photoToUpdate) {
        await store.put(photoToUpdate);
        await tx.done;
      }
    } catch (error) {
      console.error("Error removing photo from album:", error);
      return;
    }

    setPhotos(updatedPhotos);
  };

  const handleContextMenu = (e, itemId) => {
    e.preventDefault();
    const x = e.clientX;
    const y = e.clientY;
    setContextMenu({ visible: true, x, y, itemId });
  };

  const handleSelectItem = (itemId) => {
    if (isSelecting) {
      if (selectedItems.includes(itemId)) {
        setSelectedItems((prev) => prev.filter((id) => id !== itemId));
      } else {
        setSelectedItems((prev) => [...prev, itemId]);
      }
    } else {
      const photo = photos.find((p) => p.id === itemId);
      if (photo) {
        setCurrentPhoto(photo);
        setViewMode("detail");
      }
    }
  };

  const handleNextPhoto = () => {
    if (!currentPhoto) return;

    const currentIndex = filteredPhotos.findIndex((p) => p.id === currentPhoto.id);
    if (currentIndex < filteredPhotos.length - 1) {
      setCurrentPhoto(filteredPhotos[currentIndex + 1]);
    }
  };

  const handlePrevPhoto = () => {
    if (!currentPhoto) return;

    const currentIndex = filteredPhotos.findIndex((p) => p.id === currentPhoto.id);
    if (currentIndex > 0) {
      setCurrentPhoto(filteredPhotos[currentIndex - 1]);
    }
  };

  // Componente para o menu de contexto
  const ContextMenu = () => {
    if (!contextMenu.visible) return null;

    const photo = photos.find((p) => p.id === contextMenu.itemId);
    if (!photo) return null;

    return (
      <div
        className="fixed z-50 frosted-glass-strong rounded-lg shadow-lg overflow-hidden animate-fade-in"
        style={{
          left: `${contextMenu.x}px`,
          top: `${contextMenu.y}px`,
          transform: "translateX(-50%)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="py-1">
          <button
            className="w-full text-left px-4 py-2 hover:bg-primary/10 flex items-center gap-2"
            onClick={() => {
              setIsRenamingItem({ id: photo.id, type: "photo" });
              setContextMenu({ visible: false, x: 0, y: 0, itemId: null });
              setViewMode("grid");
              setCurrentPhoto(null);
            }}
          >
            <Edit className="h-4 w-4" />
            <span>Renomear</span>
          </button>

          <div className="w-full text-left px-4 py-2 hover:bg-primary/10 flex items-center gap-2 cursor-pointer relative group">
            <FolderPlus className="h-4 w-4" />
            <span>Adicionar ao álbum</span>
            <ChevronLeft className="h-4 w-4 ml-auto" />

            <div className="absolute left-full top-0 frosted-glass-strong rounded-lg shadow-lg hidden group-hover:block min-w-48">
              <div className="py-1">
                {albums
                  .filter((album) => !album.isDefault && (!photo.albums || !photo.albums.includes(album.id)))
                  .map((album) => (
                    <button
                      key={album.id}
                      className="w-full text-left px-4 py-2 hover:bg-primary/10 flex items-center gap-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAddToAlbum(photo.id, album.id);
                      }}
                    >
                      <Folder className="h-4 w-4" />
                      <span>{album.name}</span>
                    </button>
                  ))}

                <button
                  className="w-full text-left px-4 py-2 hover:bg-primary/10 flex items-center gap-2 border-t border-border mt-1 pt-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsAddingAlbum(true);
                    setSelectedItems([photo.id]);
                    setContextMenu({ visible: false, x: 0, y: 0, itemId: null });
                  }}
                >
                  <Plus className="h-4 w-4" />
                  <span>Novo álbum</span>
                </button>
              </div>
            </div>
          </div>

          {selectedView !== "all" && (
            <button
              className="w-full text-left px-4 py-2 hover:bg-primary/10 flex items-center gap-2 text-destructive"
              onClick={() => {
                handleRemoveFromAlbum(photo.id, selectedView);
                setContextMenu({ visible: false, x: 0, y: 0, itemId: null });
              }}
            >
              <Trash2 className="h-4 w-4" />
              <span>Remover deste álbum</span>
            </button>
          )}

          <button
            className="w-full text-left px-4 py-2 hover:bg-primary/10 flex items-center gap-2 text-destructive border-t border-border mt-1 pt-2"
            onClick={() => handleDeletePhotos([photo.id])}
          >
            <Trash2 className="h-4 w-4" />
            <span>Excluir</span>
          </button>
        </div>
      </div>
    );
  };

  // Componente para o modal de renomeação
  const RenameModal = () => {
    const [localItemName, setLocalItemName] = useState('');

    useEffect(() => {
      if (isRenamingItem) {
        const currentName = isRenamingItem.type === "photo"
          ? photos.find((p) => p.id === isRenamingItem.id)?.name
          : albums.find((a) => a.id === isRenamingItem.id)?.name;
        setLocalItemName(currentName || '');
      } else {
        setLocalItemName('');
      }
    }, [isRenamingItem, photos, albums]);

    if (!isRenamingItem) return null;

    const handleModalClick = (e) => {
      e.stopPropagation();
    };

    const handleKeyPress = (e) => {
      if (e.key === "Enter" && localItemName.trim()) {
        handleRename();
      }
    };

    const handleRename = async () => {
      if (!localItemName.trim()) return;

      if (isRenamingItem.type === "photo") {
        const updatedPhotos = photos.map((photo) =>
          photo.id === isRenamingItem.id
            ? { ...photo, name: localItemName.trim() }
            : photo
        );

        // Atualizar os metadados no IndexedDB
        try {
          const tx = dbRef.current.transaction("photos", "readwrite");
          const store = tx.objectStore("photos");
          const photoToUpdate = updatedPhotos.find((photo) => photo.id === isRenamingItem.id);
          if (photoToUpdate) {
            await store.put(photoToUpdate);
            await tx.done;
          }
          setPhotos(updatedPhotos);
        } catch (error) {
          console.error("Error renaming photo:", error);
          alert("Failed to rename photo. Please try again.");
          return;
        }
      } else if (isRenamingItem.type === "album") {
        setAlbums((prev) =>
          prev.map((album) =>
            album.id === isRenamingItem.id
              ? { ...album, name: localItemName.trim() }
              : album
          )
        );
      }

      setIsRenamingItem(null);
      setNewItemName('');
    };

    return (
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in"
        onClick={() => setIsRenamingItem(null)}
      >
        <div
          className="frosted-glass-strong rounded-lg p-6 max-w-md w-full mx-4 animate-slide-in"
          onClick={handleModalClick}
        >
          <h3 className="text-xl font-bold mb-4">
            Renomear {isRenamingItem.type === "photo" ? "Foto" : "Álbum"}
          </h3>

          <input
            ref={renameInputRef}
            type="text"
            value={localItemName}
            onChange={(e) => setLocalItemName(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Novo nome"
            className="w-full px-3 py-2 rounded-md border border-input bg-background/50 mb-4"
            onClick={(e) => e.stopPropagation()}
          />

          <div className="flex justify-end gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsRenamingItem(null);
              }}
              className="px-4 py-2 rounded-md border border-input hover:bg-accent"
            >
              Cancelar
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleRename();
              }}
              disabled={!localItemName.trim()}
              className="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Renomear
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Componente para o modal de criação de álbum
  const AlbumModal = () => {
    const [localAlbumName, setLocalAlbumName] = useState('');

    useEffect(() => {
      if (isAddingAlbum) {
        setLocalAlbumName(newAlbumName);
      } else {
        setLocalAlbumName('');
      }
    }, [isAddingAlbum, newAlbumName]);

    if (!isAddingAlbum) return null;

    const handleModalClick = (e) => {
      e.stopPropagation();
    };

    const handleKeyPress = (e) => {
      if (e.key === "Enter" && localAlbumName.trim()) {
        handleCreateAlbum();
      }
    };

    const handleCreateAlbum = async () => {
      if (!localAlbumName.trim()) return;

      const newAlbum = {
        id: generateId(),
        name: localAlbumName.trim(),
        isDefault: false,
        date: new Date().toISOString(),
      };

      setAlbums((prev) => [...prev, newAlbum]);
      setNewAlbumName('');
      setLocalAlbumName('');
      setIsAddingAlbum(false);

      if (selectedItems.length > 0) {
        const updatedPhotos = photos.map((photo) => {
          if (selectedItems.includes(photo.id)) {
            return {
              ...photo,
              albums: [...(photo.albums || []), newAlbum.id],
            };
          }
          return photo;
        });

        // Atualizar os metadados no IndexedDB
        try {
          const tx = dbRef.current.transaction("photos", "readwrite");
          const store = tx.objectStore("photos");
          await Promise.all(
            updatedPhotos
              .filter((photo) => selectedItems.includes(photo.id))
              .map((photo) => store.put(photo))
          );
          await tx.done;

          setPhotos(updatedPhotos);
          setSelectedItems([]);
          setIsSelecting(false);
        } catch (error) {
          console.error("Error adding photos to new album:", error);
          alert("Failed to add photos to the new album. Please try again.");
        }
      }
    };

    return (
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in"
        onClick={() => {
          setIsAddingAlbum(false);
          setSelectedItems([]);
          setNewAlbumName('');
        }}
      >
        <div
          className="frosted-glass-strong rounded-lg p-6 max-w-md w-full mx-4 animate-slide-in"
          onClick={handleModalClick}
        >
          <h3 className="text-xl font-bold mb-4">Novo Álbum</h3>

          <input
            ref={albumInputRef}
            type="text"
            value={localAlbumName}
            onChange={(e) => {
              setLocalAlbumName(e.target.value);
              setNewAlbumName(e.target.value);
            }}
            onKeyPress={handleKeyPress}
            placeholder="Nome do álbum"
            className="w-full px-3 py-2 rounded-md border border-input bg-background/50 mb-4"
            onClick={(e) => e.stopPropagation()}
          />

          <div className="flex justify-end gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsAddingAlbum(false);
                setSelectedItems([]);
                setNewAlbumName('');
              }}
              className="px-4 py-2 rounded-md border border-input hover:bg-accent"
            >
              Cancelar
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleCreateAlbum();
              }}
              disabled={!localAlbumName.trim()}
              className="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Criar
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Componente para visualização detalhada de foto/vídeo
  const DetailView = () => {
    const [currentPhotoUrl, setCurrentPhotoUrl] = useState(null);

    useEffect(() => {
      if (currentPhoto) {
        loadFileUrl(currentPhoto.fileId).then((url) => {
          setCurrentPhotoUrl(url);
        });
      }
      return () => {
        if (currentPhotoUrl && !urlCache.current.has(currentPhoto?.fileId)) {
          URL.revokeObjectURL(currentPhotoUrl);
        }
      };
    }, [currentPhoto]);

    if (!currentPhoto || !currentPhotoUrl) return null;

    return (
      <div className="fixed inset-0 bg-black/90 z-50 flex flex-col">
        <div className="frosted-glass-strong p-4 flex justify-between items-center">
          <button
            onClick={() => {
              setViewMode("grid");
              setCurrentPhoto(null);
            }}
            className="p-2 rounded-full hover:bg-background/20"
          >
            <X className="h-6 w-6" />
          </button>

          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                const a = document.createElement("a");
                a.href = currentPhotoUrl;
                a.download = currentPhoto.name;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
              }}
              className="p-2 rounded-full hover:bg-background/20"
              title="Download"
            >
              <Download className="h-5 w-5" />
            </button>

            <button
              onClick={() => {
                setIsRenamingItem({ id: currentPhoto.id, type: "photo" });
                setViewMode("grid");
                setCurrentPhoto(null);
              }}
              className="p-2 rounded-full hover:bg-background/20"
              title="Renomear"
            >
              <Edit className="h-5 w-5" />
            </button>

            <button
              onClick={() => handleDeletePhotos([currentPhoto.id])}
              className="p-2 rounded-full hover:bg-background/20 text-destructive"
              title="Excluir"
            >
              <Trash2 className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center p-4 relative">
          {currentPhoto.type === "video" ? (
            <video src={currentPhotoUrl} className="max-h-full max-w-full object-contain" controls autoPlay />
          ) : (
            <img
              src={currentPhotoUrl || "/placeholder.svg"}
              alt={currentPhoto.name}
              className="max-h-full max-w-full object-contain"
            />
          )}

          <button
            onClick={handlePrevPhoto}
            className="absolute left-4 p-3 rounded-full bg-black/30 hover:bg-black/50 text-white"
            disabled={filteredPhotos.findIndex((p) => p.id === currentPhoto.id) === 0}
          >
            <ArrowLeft className="h-6 w-6" />
          </button>

          <button
            onClick={handleNextPhoto}
            className="absolute right-4 p-3 rounded-full bg-black/30 hover:bg-black/50 text-white"
            disabled={filteredPhotos.findIndex((p) => p.id === currentPhoto.id) === filteredPhotos.length - 1}
          >
            <ArrowRight className="h-6 w-6" />
          </button>
        </div>

        <div className="frosted-glass-strong p-4">
          <h3 className="font-medium">{currentPhoto.name}</h3>
          <p className="text-sm text-muted-foreground">{formatDate(currentPhoto.date)}</p>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="frosted-glass rounded-lg shadow-lg overflow-hidden">
        <div className="flex">
          {showSidebar && (
            <div className="w-64 border-r border-border p-4 h-[calc(100vh-12rem)] overflow-y-auto">
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                <ImageIcon className="h-5 w-5 text-primary" />
                <span>Galeria</span>
              </h2>

              <div className="space-y-1 mb-6">
                <button
                  onClick={() => setSelectedView("all")}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-md flex items-center gap-2",
                    selectedView === "all" ? "bg-primary/10 text-primary" : "hover:bg-accent/50"
                  )}
                >
                  <ImageIcon className="h-4 w-4" />
                  <span>Todas as Fotos</span>
                </button>
              </div>

              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium text-muted-foreground">Álbuns</h3>
                <button
                  onClick={() => setIsAddingAlbum(true)}
                  className="p-1 rounded-full hover:bg-accent/50 text-primary"
                  title="Novo álbum"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-1">
                {albums
                  .filter((album) => !album.isDefault)
                  .sort((a, b) => new Date(b.date) - new Date(a.date))
                  .map((album) => (
                    <button
                      key={album.id}
                      onClick={() => setSelectedView(album.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setIsRenamingItem({ id: album.id, type: "album" });
                      }}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-md flex items-center gap-2 group",
                        selectedView === album.id ? "bg-primary/10 text-primary" : "hover:bg-accent/50",
                        dragOverAlbum === album.id && "bg-primary/20 border border-primary/50"
                      )}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOverAlbum(album.id);
                      }}
                      onDragLeave={() => {
                        setDragOverAlbum(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const photoId = e.dataTransfer.getData("text/plain");
                        if (photoId) {
                          handleAddToAlbum(photoId, album.id);
                          setDragOverAlbum(null);
                        }
                      }}
                    >
                      <Folder className="h-4 w-4" />
                      <span className="flex-1 truncate">{album.name}</span>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Excluir o álbum "${album.name}"?`)) {
                            handleDeleteAlbum(album.id);
                          }
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-full hover:bg-background/50 text-destructive"
                        title="Excluir álbum"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </button>
                  ))}
              </div>
            </div>
          )}

          <div className={cn("flex-1 flex flex-col h-[calc(100vh-12rem)] overflow-hidden", !showSidebar && "w-full")}>
            <div className="p-4 border-b border-border flex justify-between items-center">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowSidebar(!showSidebar)}
                  className="p-2 rounded-md hover:bg-accent/50"
                  title={showSidebar ? "Ocultar barra lateral" : "Mostrar barra lateral"}
                >
                  <ChevronLeft className={cn("h-5 w-5 transition-transform", !showSidebar && "rotate-180")} />
                </button>

                <h2 className="text-xl font-bold">
                  {selectedView === "all"
                    ? "Todas as Fotos"
                    : albums.find((a) => a.id === selectedView)?.name || "Galeria"}
                </h2>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Buscar..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 h-10 rounded-md border border-input bg-background/50 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                <button
                  onClick={() => fileInputRef.current.click()}
                  className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
                >
                  <Plus className="h-5 w-5 mr-1" />
                  Adicionar
                </button>

                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  className="hidden"
                  multiple
                  accept="image/*,video/*"
                />

                {isSelecting ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setIsSelecting(false);
                        setSelectedItems([]);
                      }}
                      className="px-4 py-2 rounded-md border border-input hover:bg-accent"
                    >
                      Cancelar
                    </button>

                    {selectedItems.length > 0 && (
                      <>
                        <button
                          onClick={() => setIsAddingAlbum(true)}
                          className="px-4 py-2 rounded-md bg-secondary hover:bg-secondary/80"
                          title="Adicionar a álbum"
                        >
                          <FolderPlus className="h-5 w-5" />
                        </button>

                        <button
                          onClick={() => {
                            if (confirm(`Excluir ${selectedItems.length} item(s)?`)) {
                              handleDeletePhotos(selectedItems);
                            }
                          }}
                          className="px-4 py-2 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          title="Excluir selecionados"
                        >
                          <Trash2 className="h-5 w-5" />
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => setIsSelecting(true)}
                    className="p-2 rounded-md hover:bg-accent/50"
                    title="Selecionar itens"
                  >
                    <MoreHorizontal className="h-5 w-5" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {filteredPhotos.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                  <ImageIcon className="h-16 w-16 mb-4 opacity-20" />
                  <p className="text-lg mb-2">Nenhuma foto encontrada</p>
                  <p className="text-sm">
                    {searchTerm
                      ? `Nenhum resultado para "${searchTerm}"`
                      : selectedView !== "all"
                      ? "Este álbum está vazio"
                      : "Adicione fotos ou vídeos para começar"}
                  </p>

                  {!searchTerm && (
                    <button
                      onClick={() => fileInputRef.current.click()}
                      className="mt-4 inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
                    >
                      <Plus className="h-5 w-5 mr-1" />
                      Adicionar
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-6">
                  {sortedDates.map((date) => (
                    <div key={date} className="space-y-2">
                      <h3 className="text-sm font-medium sticky top-0 bg-background/80 backdrop-blur-sm py-1 z-10">
                        {formatDate(date)}
                      </h3>

                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                        {groupedPhotos[date].map((photo) => (
                          <PhotoItem
                            key={photo.id}
                            photo={photo}
                            isSelecting={isSelecting}
                            selectedItems={selectedItems}
                            draggedItem={draggedItem}
                            handleSelectItem={handleSelectItem}
                            handleContextMenu={handleContextMenu}
                            setDraggedItem={setDraggedItem}
                            setDragOverAlbum={setDragOverAlbum}
                            loadFileUrl={loadFileUrl}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <ContextMenu />
      <RenameModal />
      <AlbumModal />
      {viewMode === "detail" && <DetailView />}
    </div>
  );
}

// Componente para renderizar cada item de foto, com memo para evitar re-renderizações desnecessárias
const PhotoItem = memo(
  ({ photo, isSelecting, selectedItems, draggedItem, handleSelectItem, handleContextMenu, setDraggedItem, setDragOverAlbum, loadFileUrl }) => {
    const [photoUrl, setPhotoUrl] = useState(null);

    useEffect(() => {
      loadFileUrl(photo.fileId).then((url) => {
        setPhotoUrl(url);
      });
      return () => {
        // Cleanup is handled in the parent component's urlCache
      };
    }, [photo.fileId, loadFileUrl]);

    if (!photoUrl) return null;

    return (
      <div
        className={cn(
          "group relative aspect-square rounded-md overflow-hidden border-2 transition-all duration-200",
          isSelecting && selectedItems.includes(photo.id)
            ? "border-primary ring-2 ring-primary"
            : draggedItem === photo.id
            ? "border-primary/50 opacity-50"
            : "border-transparent hover:border-primary/20"
        )}
        onClick={() => handleSelectItem(photo.id)}
        onContextMenu={(e) => handleContextMenu(e, photo.id)}
        draggable={!isSelecting}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", photo.id);
          setDraggedItem(photo.id);
        }}
        onDragEnd={() => {
          setDraggedItem(null);
          setDragOverAlbum(null);
        }}
      >
        {photo.type === "video" ? (
          <div className="h-full w-full bg-black flex items-center justify-center">
            <video src={photoUrl} className="h-full w-full object-contain" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-12 w-12 rounded-full bg-black/50 flex items-center justify-center">
                <Play className="h-6 w-6 text-white" />
              </div>
            </div>
          </div>
        ) : (
          <img
            src={photoUrl || "/placeholder.svg"}
            alt={photo.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        )}

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 translate-y-full group-hover:translate-y-0 transition-transform duration-300">
          <p className="text-white text-sm truncate">{photo.name}</p>
        </div>

        {isSelecting && (
          <div className="absolute top-2 right-2 h-6 w-6 rounded-full bg-background/80 flex items-center justify-center">
            {selectedItems.includes(photo.id) ? (
              <Check className="h-4 w-4 text-primary" />
            ) : (
              <div className="h-4 w-4 rounded-full border-2 border-foreground" />
            )}
          </div>
        )}
      </div>
    );
  },
  (prevProps, nextProps) => {
    // Evitar re-renderizações se as props relevantes não mudaram
    return (
      prevProps.photo.id === nextProps.photo.id &&
      prevProps.photo.fileId === nextProps.photo.fileId &&
      prevProps.isSelecting === nextProps.isSelecting &&
      prevProps.selectedItems.includes(prevProps.photo.id) === nextProps.selectedItems.includes(nextProps.photo.id) &&
      prevProps.draggedItem === nextProps.draggedItem
    );
  }
);

export default PhotoGallery;
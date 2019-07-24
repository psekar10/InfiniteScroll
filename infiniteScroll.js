define('infinite_scroll', ['jquery', 'handlebars', 'underscore'], function($, Handlebars, _) {
  'use strict';

  (function() {
    var VISIBLE = 1,
      IMAGES_HIDDEN = 2,
      PAGE_HIDDEN = 3,
      PAGE_REMOVED = 4;
    var InfiniteScroll = function InfiniteScroll(element, config) {
      var _self = this,
        i;
      this.config = config;
      this.element = $(element);

      // check if we have a compiled handlebars template already
      this.itemTemplate = this.config.itemTemplate;
      if (typeof this.itemTemplate === 'string') {
        this.itemTemplate = Handlebars.compile(this.itemTemplate);
      }

      this.pages = [];
      this.visiblePage = null;
      this.requestInProgress = false;
      if (typeof this.config.columns === 'number') {
        this.initColumns(this.config.columns);
      } else if (this.config.columns === 'auto') {
        this.columns = [this.element];
      } else {
        this.columns = [];
      }

      this.loadingPanel = $('<div style="position:absolute;left:-100000px" />');
      this.loadingPanel.appendTo(document.body);

      this.loadingAlert = $('<div class="infinite-scroll-loading"><span class="message">' + this.config.loading.msgText + '</span><div class="waiting"></div></div>');
      this.element.after(this.loadingAlert);
      this.isLoading = true;

      this.config.wrapper.on('scroll', _.throttle(function() {
        if (_self.isLoading) {
          _self.loadMore();
        }
        _self.checkForPageChange();
      }, 200));
      if (this.config.pages && this.config.pages.length > 0) {
        for (i = 0; i < this.config.pages.length; i++) {
          this.renderPage(this.config.pages[i], i);
        }
      } else if (this.element.html() !== '') {
        var currentPageIndex = this.config.pageIndexStart;
        if (this.config.scrollUp && currentPageIndex > 0) {
          //if we are starting in the middle of an infinite scroll and want to allow scrolling up

          var pageHeight = this.element.outerHeight(true);
          for (var pageIndex = 0; pageIndex < currentPageIndex; pageIndex++) {
            this.pages.push({
              state: PAGE_REMOVED,
              index: pageIndex,
              column: 0,
              height: pageHeight,
              padding: 'top',
              top: pageIndex * pageHeight,
              bottom: (pageIndex * pageHeight) + pageHeight,
              url: this.config.urlFunction(pageIndex, currentPageIndex),
              wrapper: $('<div style="height:' + pageHeight + 'px" />')
            });
          }
          this.element.css({marginTop: pageHeight * currentPageIndex});
          this.scrollTo(this.element.offset().top);
          this.addPage(currentPageIndex, undefined, this.element.children().not('.infinite-scroll-column'));
          this.checkForPageChange();
        } else {
          this.addPage(currentPageIndex, undefined, this.element.children().not('.infinite-scroll-column'));
        }
      } else {
        this.loadMore();
      }
      window.pages = this.pages;
    };

    // used for when a filter is clicked, reset the data, load more url, and re-calculate columns
    InfiniteScroll.prototype.reset = function(config) {
      this.config = _.extend(this.config, config);
      this.pages = [];
      this.visiblePage = null;
      this.requestInProgress = false;
      this.isLoading = true;
      if (this.config.pages && this.config.pages.length > 0) {
        for (var i = 0; i < this.config.pages.length; i++) {
          this.renderPage(this.config.pages[i], i);
        }
      } else if (this.element.html() !== '') {
        this.addPage(0, undefined, this.element.children().not('.infinite-scroll-column'));
      } else {
        this.loadMore();
      }
      this.remeasureAll();
    };

    InfiniteScroll.prototype.getConfig = function getConfig() {
      return this.config;
    };

    InfiniteScroll.prototype.initColumns = function initColumns(numColumns) {
      this.columns = [];
      var columnWidth = 100 / numColumns;
      for (var i = 0; i < numColumns; i++) {
        this.columns.push($('<div class="infinite-scroll-column" style="float:left;width:' + columnWidth + '%;" />').appendTo(this.element));
        this.columns[i][0].index = i;
      }
      this.element.css('overflow', 'hidden');
    };

    InfiniteScroll.prototype.loadMore = function loadMore() {
      //if we already have a request in progress, we do not want to load more regardless of where we are in the viewport

      if (!this.requestInProgress && !this.config.externalRequestInProgress) {
        //set this immediately so nothing can sneak through, we unset it if either the bottom is not in view
        //or upon completing a successful request

        this.requestInProgress = true;
        if (_bottomInView(this.config.wrapper, this.element, this.config.bufferFromBottom)) {
          // moreUrl was not set by last data set
          // end of results.

          if (!this.config.moreUrl) {
            this.endLoading();
          } else {
            this.isLoading = false;
            var moreUrl = this.config.moreUrl,
              dataObj = {};
            this.config.moreUrl = null;

            var _self = this;
            this.loadingAlert.fadeIn(this.config.loading.speed);

            if (typeof moreUrl === 'object') {
              dataObj = moreUrl.data;
              moreUrl = moreUrl.url;
            }

            $.ajax({
              url: moreUrl,
              data: dataObj,
              dataType: 'json',
              success: function(scrollData) {
                _self.isLoading = true;
                var loadedPages = _self.pages.length / _self.columns.length;
                var itemData = scrollData;
                if (_self.config.dataKey) {
                  itemData = itemData[_self.config.dataKey];
                }
                _self.renderPage(itemData, loadedPages);

                if (isNaN(loadedPages) || loadedPages < _self.config.maxPages) {
                  _self.config.moreUrl = scrollData.moreUrl;
                }
              },
              error: function() {
                _self.endLoading();
              }
            });
          }
        } else {
          //bottom is not in view, unset this so we can make further requests if needed

          this.requestInProgress = false;
        }
      }
    };

    InfiniteScroll.prototype.endLoading = function endLoading() {
      var _self = this;
      this.isLoading = false;
      this.requestInProgress = false;
      this.loadingAlert.html(this.config.loading.finishedMsg)
        .fadeIn(this.config.loading.speed);

      setTimeout(function() {
        _self.loadingAlert.fadeOut(_self.config.loading.speed);
      }, 3000);
    };

    InfiniteScroll.prototype.beginLoading = function beginLoading() {
      this.loadingAlert.html('<div class="infinite-scroll-loading"><span class="message">' + this.config.loading.msgText + '</span><div class="waiting"></div></div>');
      this.loadMore();
    };

    InfiniteScroll.prototype.renderPage = function renderPage(itemData, pageIndex) {
      var i;
      if (typeof itemData === 'object') {
        if (!(itemData instanceof Array)) {
          itemData = [itemData];
        }
        var pageHtml = '';
        for (i = 0; i < itemData.length; i++) {
          pageHtml += this.itemTemplate(itemData[i]);
        }
        this.loadingPanel.html(pageHtml);
      }

      var imgs = this.loadingPanel.find('img'),
        _self = this;
      this.pollImagesLoaded(imgs, function() {
        _self.addPage(pageIndex, itemData);
      });
    };

    InfiniteScroll.prototype.pollImagesLoaded = function pollImagesLoaded(imgs, callback) {
      var _self = this;
      setTimeout(function() {
        if (_self.checkImagesLoaded(imgs)) {
          callback();
        } else {
          _self.pollImagesLoaded(imgs, callback);
        }
      }, 0);
    };


    InfiniteScroll.prototype.checkImagesLoaded = function checkImagesLoaded(imgs) {
      var numImages = imgs.length,
        loadedImages = 0;
      for (var i = numImages; i--;) {
        if (imgs[i].height > 0) {
          loadedImages++;
        }
      }
      return loadedImages === numImages;
    };

    InfiniteScroll.prototype.addPage = function addPage(pageIndex, itemData, children) {
      var newColumns = [],
        j, k;

      if (typeof children === 'undefined') {
        children = this.loadingPanel.children();
      }

      if (this.columns.length === 0) {
        var containerWidth = this.config.wrapper.width(),
          panelWidth = children.eq(0).width(),
          numColumns = Math.floor(containerWidth / panelWidth);
        this.initColumns(numColumns);
      }

      for (j = 0; j < this.columns.length; j++) {
        var newColumn = document.createElement('div');
        newColumn.className = 'page page-' + (pageIndex) + ' ' + this.config.pageClass;
        this.columns[j].append(newColumn);

        newColumns.push({
          wrapper: $(newColumn),
          state: VISIBLE,
          index: pageIndex,
          column: j,
          height: this.columns[j].outerHeight(true)
        });
      }
      if (newColumns.length === 1) {
        newColumns[0].wrapper.append(children);
      } else {
        var shortestIndex, shortestHeight, child;
        for (j = 0; j < children.length; j++) {
          child = children.eq(j);
          shortestIndex = 0;
          shortestHeight = Infinity;
          for (k = 0; k < newColumns.length; k++) {
            if (newColumns[k].height < shortestHeight) {
              shortestIndex = k;
              shortestHeight = newColumns[k].height;
            }
          }
          newColumns[shortestIndex].wrapper.append(child);
          newColumns[shortestIndex].height = this.columns[shortestIndex].outerHeight(true);
        }
      }

      for (j = 0; j < newColumns.length; j++) {
        var pageData = newColumns[j];
        pageData.height = pageData.wrapper.height();
        pageData.top = pageData.wrapper.offset().top - 100;
        if (this.config.wrapper[0].nodeName !== undefined) {
          pageData.top += this.config.wrapper.scrollTop() - this.config.wrapper.offset().top;
        }
        pageData.bottom = pageData.top + pageData.height + 100;
      }

      this.pages.push.apply(this.pages, newColumns);

      if (itemData) {
        this.element.trigger('InfiniteScrollNewData', [children, itemData]);
      }

      //this should be the last part of loading data after an ajax request, we can set
      //requestInProgress to false so that new requests can be made

      this.loadingAlert.fadeOut(this.config.loading.speed);
      this.requestInProgress = false;
    };

    InfiniteScroll.prototype.updateColumns = function updateColumns() {
      var i, pageData;
      for (i = this.pages.length; i--;) {
        pageData = this.pages[i];
        if (pageData.state !== PAGE_REMOVED) {
          pageData.height = pageData.wrapper.height();
          pageData.top = pageData.wrapper.offset().top - 100;
          if (this.config.wrapper[0].nodeName !== undefined) {
            pageData.top += this.config.wrapper.scrollTop() - this.config.wrapper.offset().top;
          }
          pageData.bottom = pageData.top + pageData.height + 100;
        }
      }
    };

    /*
      Refreshes all of the measurements on the page. Used for search filters on Daily Sales/Joss event pages.
    */
    InfiniteScroll.prototype.remeasureAll = function remeasureAll() {
      this.checkForPageChange(Infinity);
      this.updateColumns();
      this.checkForPageChange();
    };

    InfiniteScroll.prototype.scrollTo = function scrollTo(amount, type) {
      var amt = parseFloat(amount);
      if (!type) {
        this.config.wrapper.scrollTop(amt);
      } else if (type === 'percent') {
        var height = this.config.wrapper.prop('scrollHeight');
        this.config.wrapper.scrollTop(height * amt / 100);
      } else if (type === 'page') {
        var numColumns = this.columns.length,
          relevantColumns = this.pages.slice(amt * numColumns, amt * numColumns + numColumns),
          columnTops = $.map(relevantColumns, function(col) {
            return col.top;
          }),
          topColumn = Math.min.apply(Math, columnTops) + 100;

        this.config.wrapper.scrollTop(topColumn);
      }
    };

    InfiniteScroll.prototype.loadPreviousPage = function (page) {
      var self = this;
      $.ajax({
        url: page.url + '&_format=json',
        dataType: 'json'
      }).done(function(itemData) {
        if (self.config.dataKey) {
          itemData = itemData[self.config.dataKey];
        }
        if (typeof itemData === 'object') {
          if (!(itemData instanceof Array)) {
            itemData = [itemData];
          }
          var pageHtml = '';
          for (var i = 0; i < itemData.length; i++) {
            pageHtml += self.itemTemplate(itemData[i]);
          }
          var newPage = $(pageHtml);
          page.wrapper.replaceWith(newPage);
          page.wrapper = newPage;
        }
      });
      page.url = null;
    };

    InfiniteScroll.prototype.checkForPageChange = function checkForPageChange(overrideSize) {
      var windowSize = overrideSize || this.config.wrapper.height(),
        windowTop = this.config.wrapper.scrollTop(),
        windowBottom = windowTop + windowSize,
        onePage = windowSize,
        twoPage = windowSize * 2,
        mostlyVisible = {
          pageData: null,
          amount: 0
        };

      var states = [],
        paddings = {
          top: [],
          bottom: []
        },
        stubSizes = [];

      for (var i = 0; i < this.columns.length; i++) {
        stubSizes[i] = {
          marginTop: 0,
          marginBottom: 0
        };
      }
      for (i = this.pages.length; i--;) {
        var pageData = this.pages[i];
        if (windowBottom + twoPage < pageData.top) {
          stubSizes[pageData.column].marginBottom += pageData.height;
          pageData.padding = 'bottom';
          states[i] = _setUnrendered;
        } else if (windowTop - twoPage > pageData.bottom) {
          stubSizes[pageData.column].marginTop += pageData.height;
          pageData.padding = 'top';
          states[i] = _setUnrendered;
        } else {
          if (pageData.state === PAGE_REMOVED) {
            paddings[pageData.padding][i] = pageData;
          }
          if (windowBottom > pageData.top && windowTop < pageData.bottom) {
            states[i] = _setFullyVisible;
            var amt = 0;
            if (windowBottom > pageData.bottom) {
              amt = pageData.bottom - windowTop;
            } else if (windowTop < pageData.top) {
              amt = windowBottom - pageData.top;
            } else {
              amt = windowBottom - windowTop;
            }

            if (amt > mostlyVisible.amount) {
              mostlyVisible = {
                pageData: pageData,
                amount: amt
              };
            }
          } else if (windowBottom + onePage < pageData.top || windowTop - onePage > pageData.bottom) {
            states[i] = _setInvisible;
          } else if (windowBottom < pageData.top || windowTop > pageData.bottom) {
            states[i] = _setImagesHidden;
          }
        }
      }

      // The config variable firstPageBypassScroll is set to true by default
      // to prevent infinite scroll event from triggering
      // on the first event of the events page
      // Set it to false in the infinite scroll config for any page that needs to fire this event on the first page

      if (mostlyVisible.pageData && (!this.visiblePage || mostlyVisible.pageData.index !== this.visiblePage.index)) {
        if (!this.config.firstPageBypassScroll) {
          this.element.trigger('InfiniteScrollScrollTo', [mostlyVisible.pageData.index, mostlyVisible.pageData.wrapper]);
        }
        this.visiblePage = mostlyVisible.pageData;
        this.config.firstPageBypassScroll = false;
      }

      for (i = paddings.top.length; i--;) {
        if (paddings.top[i]) {
          if (paddings.top[i].url) {
            this.loadPreviousPage(this.pages[i]);
          }
          this.columns[paddings.top[i].column].prepend(paddings.top[i].wrapper);
        }
      }
      for (i = 0; i < paddings.bottom.length; i++) {
        if (paddings.bottom[i]) {
          this.columns[paddings.bottom[i].column].append(paddings.bottom[i].wrapper);
        }
      }
      for (i = states.length; i--;) {
        if (states[i]) {
          states[i].call(null, this.pages[i]);
        }
      }
      for (i = 0; i < this.columns.length; i++) {
        this.columns[i].css(stubSizes[i]);
      }
    };

    /** State changes **/
    var _setFullyVisible = function _setFullyVisible(pageData) {
      if (pageData && pageData.wrapper && pageData.state !== VISIBLE) {
        pageData.state = VISIBLE;
        pageData.wrapper
          .css('visibility', 'visible')
          .find('img').css('visibility', 'visible');
      }
    };
    var _setImagesHidden = function _setImagesHidden(pageData) {
      //Short-circuiting - as the this whole image hiding is breaking display
      if (pageData && pageData.wrapper && pageData.state !== IMAGES_HIDDEN) {
        pageData.state = IMAGES_HIDDEN;
        /*
        pageData.wrapper
          .css('visibility', 'visible')
          .find('img').css('visibility', 'hidden');
        */
      }
    };
    var _setInvisible = function _setInvisible(pageData) {
      if (pageData && pageData.wrapper && pageData.state !== PAGE_HIDDEN) {
        pageData.state = PAGE_HIDDEN;
        pageData.wrapper
          .css('visibility', 'hidden');
      }
    };
    var _setUnrendered = function _setUnrendered(pageData) {
      if (pageData && pageData.wrapper && pageData.state !== PAGE_REMOVED) {
        pageData.state = PAGE_REMOVED;
        pageData.wrapper.detach();
      }
    };

    var _bottomInView = function _bottomInView(wrapper, element, bufferFromBottom) {
      var wrapperHeight = wrapper.height(),
        elementTop = element.offset().top,
        elementHeight = element.height();

      // if the wrapper is the Window
      if (wrapper[0].nodeName === undefined) {
        elementTop -= wrapper.scrollTop();
      } else {
        elementTop -= wrapper.offset().top;
      }
      return (wrapperHeight - elementTop + bufferFromBottom) >= elementHeight;
    };

    var defaultConfig = {
      loading: {
        finishedMsg: 'No more to load',
        img: '',
        msgText: 'Loading...',
        speed: ''
      },
      columns: 'auto',
      moreUrl: null,
      pages: [],
      pageClass: '',
      bufferFromBottom: 0,
      maxPages: Infinity,
      wrapper: $(window),
      dataKey: 'data',
      itemTemplate: '',
      externalRequestInProgress: false,
      firstPageBypassScroll: true,
      //below here are options to do with starting an infinite scroll from the middle
      //this is a hacked together feature so be careful

      scrollUp: false,
      pageIndexStart: 0,
      urlFunction: null
    };
    $.fn.infiniteScroll = function infiniteScroll(options) {
      if (typeof options === 'string') {
        var otherArgs = Array.prototype.slice.call(arguments, 1),
          result = null;

        this.each(function() {
          var plugin = $.data(this, 'InfiniteScroll');
          if (plugin && plugin[options]) {
            result = plugin[options].apply(plugin, otherArgs);
          }
        });
        return result;
      } else {
        var config = $.extend(true, defaultConfig, options);
        return this.each(function() {
          var alreadySet = $.data(this, 'InfiniteScroll');
          if (!alreadySet) {
            $.data(this, 'InfiniteScroll', new InfiniteScroll(this, config));
          }
        });
      }
    };
  })();
});